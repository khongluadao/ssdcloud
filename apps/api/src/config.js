import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  // When running via npm workspaces, cwd is often apps/api, while .env is at repo root.
  // Try a few parent directories to locate the root .env.
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", "..", ".env"),
    path.resolve(process.cwd(), "..", "..", "..", ".env"),
  ];

  const found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    dotenv.config({ path: found, override: false });
    return;
  }

  // Fall back to default behavior (useful when env vars are already set).
  dotenv.config();
}

loadEnv();

if (!process.env.S3_ENDPOINT) {
  throw new Error("S3_ENDPOINT is not set");
}
if (!process.env.S3_REGION) {
  throw new Error("S3_REGION is not set");
}
if (!process.env.S3_BUCKET) {
  throw new Error("S3_BUCKET is not set");
}
if (!process.env.S3_ACCESS_KEY) {
  throw new Error("S3_ACCESS_KEY is not set");
}
if (!process.env.S3_SECRET_KEY) {
  throw new Error("S3_SECRET_KEY is not set");
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017/ssdcloud",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "dev_access_secret",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev_refresh_secret",
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? "7d",
  uploadPricePerMb: Number(process.env.UPLOAD_PRICE_PER_MB ?? 0.5),
  uploadMaxMb: Number(process.env.UPLOAD_MAX_MB ?? 100),
  multipartPartSizeMb: Number(process.env.MULTIPART_PART_SIZE_MB ?? 100),
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "ssdcloud-files",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "change_me_r2_access_key",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "change_me_r2_secret_key",
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
};
