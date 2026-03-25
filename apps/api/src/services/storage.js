import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

const client = new S3Client({
  region: config.s3Region,
  endpoint: config.s3Endpoint || undefined,
  forcePathStyle: config.s3ForcePathStyle,
  credentials: {
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  },
});

export function buildObjectKey(userId, originalName) {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safeName}`;
}

export async function uploadToStorage({ objectKey, buffer, mimeType }) {
  const command = new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: objectKey,
    Body: buffer,
    ContentType: mimeType,
  });
  await client.send(command);
}

export async function ensureBucketExists() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.s3Bucket }));
  }
}

export async function ensureBucketCors() {
  const corsRule = {
    AllowedOrigins: [config.corsOrigin],
    AllowedMethods: ["GET", "HEAD", "PUT", "POST", "DELETE"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  };

  try {
    const existing = await client.send(new GetBucketCorsCommand({ Bucket: config.s3Bucket }));
    const rules = existing.CORSRules ?? [];
    const alreadyConfigured = rules.some((rule) => {
      const origins = rule.AllowedOrigins ?? [];
      const methods = rule.AllowedMethods ?? [];
      return origins.includes(config.corsOrigin) && methods.includes("PUT");
    });
    if (alreadyConfigured) {
      return;
    }
  } catch {
    // No existing CORS config; create one below.
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: config.s3Bucket,
      CORSConfiguration: { CORSRules: [corsRule] },
    })
  );
}

export async function deleteFromStorage(objectKey) {
  const command = new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: objectKey });
  await client.send(command);
}

export async function getSignedDownloadUrl(objectKey, expiresInSeconds = 60) {
  const command = new GetObjectCommand({ Bucket: config.s3Bucket, Key: objectKey });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export async function createMultipartUpload({ objectKey, mimeType }) {
  const command = new CreateMultipartUploadCommand({
    Bucket: config.s3Bucket,
    Key: objectKey,
    ContentType: mimeType,
  });
  const response = await client.send(command);
  if (!response.UploadId) {
    throw new Error("multipart_upload_id_missing");
  }
  return response.UploadId;
}

export async function getPresignedPartUrl({ objectKey, uploadId, partNumber, expiresInSeconds = 900 }) {
  const command = new UploadPartCommand({
    Bucket: config.s3Bucket,
    Key: objectKey,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export async function completeMultipartUpload({ objectKey, uploadId, parts }) {
  const command = new CompleteMultipartUploadCommand({
    Bucket: config.s3Bucket,
    Key: objectKey,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts.map((part) => ({
        ETag: part.etag,
        PartNumber: part.partNumber,
      })),
    },
  });
  await client.send(command);
}

export async function abortMultipartUpload({ objectKey, uploadId }) {
  const command = new AbortMultipartUploadCommand({
    Bucket: config.s3Bucket,
    Key: objectKey,
    UploadId: uploadId,
  });
  await client.send(command);
}
