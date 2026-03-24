import fs from "node:fs/promises";

const [, , filePath, apiKey, baseUrlArg] = process.argv;

if (!filePath || !apiKey) {
  console.error("Usage: node scripts/smoke-upload.mjs <filePath> <apiKey> [baseUrl]");
  process.exit(1);
}

const baseUrl = baseUrlArg ?? "http://localhost:4000";
const buffer = await fs.readFile(filePath);
const fileName = filePath.split(/[\\/]/).pop() || "upload.bin";
const mimeType = "application/octet-stream";

const initiateResponse = await fetch(`${baseUrl}/api/files/upload/initiate`, {
  method: "POST",
  headers: {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    fileName,
    fileSize: buffer.byteLength,
    mimeType,
  }),
});

const initiateData = await initiateResponse.json();
if (!initiateResponse.ok) {
  console.error("Smoke upload initiate failed:", initiateData);
  process.exit(1);
}

const uploadId = initiateData.upload?.id;
if (!uploadId) {
  console.error("Smoke upload initiate missing upload id:", initiateData);
  process.exit(1);
}

const presignResponse = await fetch(`${baseUrl}/api/files/upload/${uploadId}/presign`, {
  method: "POST",
  headers: {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ partNumbers: [1] }),
});

const presignData = await presignResponse.json();
if (!presignResponse.ok) {
  console.error("Smoke upload presign failed:", presignData);
  process.exit(1);
}

const partUrl = presignData.urls?.["1"];
if (!partUrl) {
  console.error("Smoke upload presign missing part url:", presignData);
  process.exit(1);
}

const putResponse = await fetch(partUrl, {
  method: "PUT",
  body: buffer,
});
if (!putResponse.ok) {
  console.error("Smoke upload part PUT failed:", { status: putResponse.status });
  process.exit(1);
}

const etag = putResponse.headers.get("etag");
if (!etag) {
  console.error("Smoke upload part PUT missing etag");
  process.exit(1);
}

const completeResponse = await fetch(`${baseUrl}/api/files/upload/${uploadId}/complete`, {
  method: "POST",
  headers: {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    parts: [{ partNumber: 1, etag }],
  }),
});

const completeData = await completeResponse.json();
if (!completeResponse.ok) {
  console.error("Smoke upload complete failed:", completeData);
  process.exit(1);
}

console.log("Smoke upload success:", completeData);
