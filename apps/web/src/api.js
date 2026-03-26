const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

function buildAuthHeaders({ token, apiKey }) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

function isAbortError(error) {
  return error && typeof error === "object" && error.name === "AbortError";
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function authedJsonFetch(path, { method = "POST", body, token, apiKey, signal } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders({ token, apiKey }),
    },
    credentials: "include",
    signal,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include",
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data.message || "Request failed";
    throw new Error(message);
  }
  return data;
}

export async function uploadFetch(path, { formData, token, apiKey }) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    body: formData,
    headers: buildAuthHeaders({ token, apiKey }),
    credentials: "include",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Upload failed");
  }
  return data;
}

export async function getUploadQuote({ file, token, apiKey, signal }) {
  return authedJsonFetch("/api/files/upload/quote", {
    body: {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    },
    token,
    apiKey,
    signal,
  });
}

export async function multipartUpload({
  file,
  token,
  apiKey,
  onProgress,
  signal,
  presignBatchSize = 10,
  concurrency = 4,
  maxRetries = 3,
}) {
  let uploadId = null;

  try {
    const initiate = await authedJsonFetch("/api/files/upload/initiate", {
      body: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      },
      token,
      apiKey,
      signal,
    });

    uploadId = initiate.upload.id;
    const partSize = initiate.upload.partSize;
    const totalParts = initiate.upload.totalParts;
    let uploadedBytes = 0;
    const uploadedParts = new Map();

    onProgress?.(0, file.size);

    async function uploadOnePart(partNumber, presignedUrl) {
      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const chunk = file.slice(start, end);
      const chunkSize = end - start;

      let lastError = null;
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          const response = await fetch(presignedUrl, {
            method: "PUT",
            body: chunk,
            signal,
          });
          if (!response.ok) {
            throw new Error(`Chunk upload failed (${response.status})`);
          }
          const etag = response.headers.get("etag");
          if (!etag) {
            throw new Error("Missing ETag from storage response");
          }
          uploadedParts.set(partNumber, etag);
          uploadedBytes += chunkSize;
          onProgress?.(uploadedBytes, file.size);
          return;
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          lastError = error;
          if (attempt < maxRetries) {
            await sleep(200 * 2 ** (attempt - 1));
          }
        }
      }

      throw lastError || new Error("Chunk upload failed");
    }

    async function uploadBatch(partNumbers, urlsByPart) {
      const queue = [...partNumbers];

      async function worker() {
        while (queue.length > 0) {
          const partNumber = queue.shift();
          const url = urlsByPart[String(partNumber)];
          if (!url) {
            throw new Error(`Missing presigned URL for part ${partNumber}`);
          }
          await uploadOnePart(partNumber, url);
        }
      }

      const workerCount = Math.min(concurrency, queue.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    for (let index = 0; index < totalParts; index += presignBatchSize) {
      const partNumbers = [];
      for (let i = index + 1; i <= Math.min(totalParts, index + presignBatchSize); i += 1) {
        partNumbers.push(i);
      }

      const presign = await authedJsonFetch(`/api/files/upload/${uploadId}/presign`, {
        body: { partNumbers },
        token,
        apiKey,
        signal,
      });
      await uploadBatch(partNumbers, presign.urls || {});
    }

    const completeParts = [...uploadedParts.entries()]
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);

    return authedJsonFetch(`/api/files/upload/${uploadId}/complete`, {
      body: { parts: completeParts },
      token,
      apiKey,
      signal,
    });
  } catch (error) {
    if (uploadId) {
      try {
        await authedJsonFetch(`/api/files/upload/${uploadId}/abort`, {
          token,
          apiKey,
        });
      } catch {
        // Ignore abort failures because original error is more relevant.
      }
    }
    if (isAbortError(error)) {
      throw new Error("Upload canceled");
    }
    throw error;
  }
}

export async function upsertFileShare({ fileId, ttlSeconds, downloadCostToken, isActive, token }) {
  return apiFetch(`/api/files/${fileId}/share`, {
    method: "POST",
    body: JSON.stringify({ ttlSeconds, downloadCostToken, isActive }),
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function getShareInfo(slug) {
  return apiFetch(`/api/share/${slug}`);
}

export async function unlockShareDownload({ slug, token }) {
  return apiFetch(`/api/share/${slug}/unlock`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function getShareDownloadUrl(slug) {
  return apiFetch(`/api/share/${slug}/download`);
}
