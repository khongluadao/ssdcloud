import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import mongoose from "mongoose";
import { z } from "zod";
import { config } from "./config.js";
import { connectDatabase } from "./db.js";
import { requireAuth, requireUploadAuth } from "./middleware/auth.js";
import { validateBody } from "./middleware/validate.js";
import { ApiKey } from "./models/ApiKey.js";
import { FileObject } from "./models/FileObject.js";
import { PendingUpload } from "./models/PendingUpload.js";
import { User } from "./models/User.js";
import { getApiKeyPrefix, generateApiKey, hashApiKey } from "./services/apiKeys.js";
import { calcUploadCost } from "./services/billing.js";
import {
  abortMultipartUpload,
  buildObjectKey,
  completeMultipartUpload,
  createMultipartUpload,
  deleteFromStorage,
  ensureBucketExists,
  getPresignedPartUrl,
  getSignedDownloadUrl,
  uploadToStorage,
} from "./services/storage.js";
import { issueAccessToken, issueRefreshToken, sha256, verifyRefreshToken } from "./services/tokens.js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxMb * 1024 * 1024 },
});

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
});

const createKeySchema = z.object({
  name: z.string().min(2).max(50),
});

const topupSchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
});

const uploadQuoteSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive(),
  mimeType: z.string().trim().min(1).max(255).default("application/octet-stream"),
});

const initiateMultipartSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive(),
  mimeType: z.string().trim().min(1).max(255).default("application/octet-stream"),
});

const presignMultipartSchema = z.object({
  partNumbers: z.array(z.number().int().min(1)).min(1).max(100),
});

const completeMultipartSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1),
        etag: z.string().trim().min(1).max(512),
      })
    )
    .min(1)
    .max(10_000),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const S3_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
const S3_MAX_PARTS = 10_000;
const S3_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;

function buildMultipartPlan(fileSize) {
  if (fileSize > S3_MAX_FILE_SIZE_BYTES) {
    throw new Error("file_too_large");
  }

  let partSize = Math.max(S3_MIN_PART_SIZE_BYTES, config.multipartPartSizeMb * 1024 * 1024);
  if (partSize <= 0 || !Number.isFinite(partSize)) {
    partSize = 100 * 1024 * 1024;
  }

  let totalParts = Math.ceil(fileSize / partSize);
  if (totalParts > S3_MAX_PARTS) {
    partSize = Math.ceil(fileSize / S3_MAX_PARTS);
    partSize = Math.max(S3_MIN_PART_SIZE_BYTES, partSize);
    totalParts = Math.ceil(fileSize / partSize);
  }

  return { partSize, totalParts };
}

function setRefreshCookie(res, refreshToken) {
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie("refreshToken");
}

app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/register", authLimiter, validateBody(registerSchema), async (req, res) => {
  const { email, password } = req.body;
  const exists = await User.findOne({ email });
  if (exists) {
    return res.status(409).json({ message: "Email already in use" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash, balance: 0 });

  const accessToken = issueAccessToken(user);
  const refreshToken = issueRefreshToken(user);
  user.refreshTokenHash = sha256(refreshToken);
  await user.save();

  setRefreshCookie(res, refreshToken);
  return res.status(201).json({
    user: { id: user._id, email: user.email, balance: user.balance },
    accessToken,
  });
});

app.post("/api/auth/login", authLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const accessToken = issueAccessToken(user);
  const refreshToken = issueRefreshToken(user);
  user.refreshTokenHash = sha256(refreshToken);
  await user.save();

  setRefreshCookie(res, refreshToken);
  return res.json({
    user: { id: user._id, email: user.email, balance: user.balance },
    accessToken,
  });
});

app.post("/api/auth/refresh", async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) {
    return res.status(401).json({ message: "Missing refresh token" });
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return res.status(401).json({ message: "Invalid refresh token" });
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.refreshTokenHash) {
    return res.status(401).json({ message: "Invalid refresh token" });
  }

  if (user.refreshTokenHash !== sha256(token)) {
    return res.status(401).json({ message: "Invalid refresh token" });
  }

  const newAccessToken = issueAccessToken(user);
  const newRefreshToken = issueRefreshToken(user);
  user.refreshTokenHash = sha256(newRefreshToken);
  await user.save();
  setRefreshCookie(res, newRefreshToken);

  return res.json({ accessToken: newAccessToken });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  req.user.refreshTokenHash = null;
  await req.user.save();
  clearRefreshCookie(res);
  return res.json({ message: "Logged out" });
});

app.get("/api/me", requireAuth, async (req, res) => {
  return res.json({
    id: req.user._id,
    email: req.user.email,
    balance: req.user.balance,
    roles: req.user.roles,
  });
});

app.get("/api/me/balance", requireAuth, async (req, res) => {
  return res.json({ balance: req.user.balance });
});

app.post("/api/me/topup", requireAuth, validateBody(topupSchema), async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $inc: { balance: req.body.amount } },
    { new: true }
  );
  return res.json({ balance: user.balance });
});

app.post("/api/keys", requireAuth, validateBody(createKeySchema), async (req, res) => {
  const rawKey = generateApiKey();
  const key = await ApiKey.create({
    userId: req.user._id,
    name: req.body.name,
    keyPrefix: getApiKeyPrefix(rawKey),
    keyHash: hashApiKey(rawKey),
  });
  return res.status(201).json({
    key: {
      id: key._id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    },
    plaintextKey: rawKey,
  });
});

app.get("/api/keys", requireAuth, async (req, res) => {
  const keys = await ApiKey.find({ userId: req.user._id }).sort({ createdAt: -1 });
  return res.json(
    keys.map((key) => ({
      id: key._id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    }))
  );
});

app.delete("/api/keys/:id", requireAuth, async (req, res) => {
  const key = await ApiKey.findOne({ _id: req.params.id, userId: req.user._id });
  if (!key) {
    return res.status(404).json({ message: "Key not found" });
  }
  key.revokedAt = new Date();
  await key.save();
  return res.json({ message: "Key revoked" });
});

app.post(
  "/api/files/upload/quote",
  uploadLimiter,
  requireUploadAuth,
  validateBody(uploadQuoteSchema),
  async (req, res) => {
    const { fileSize } = req.body;

    if (fileSize > S3_MAX_FILE_SIZE_BYTES) {
      return res.status(413).json({ message: "File exceeds maximum supported size (5TB)" });
    }

    const cost = calcUploadCost(fileSize);
    const currentBalance = req.user.balance;
    const balanceAfter = currentBalance - cost;
    const deliveryMode = fileSize > MULTIPART_THRESHOLD_BYTES ? "multipart" : "simple";

    return res.json({
      cost,
      currentBalance,
      balanceAfter,
      insufficient: balanceAfter < 0,
      deliveryMode,
    });
  }
);

app.post(
  "/api/files/upload/initiate",
  uploadLimiter,
  requireUploadAuth,
  validateBody(initiateMultipartSchema),
  async (req, res) => {
    const { fileName, fileSize, mimeType } = req.body;
    let uploadId = null;
    let objectKey = null;

    let multipartPlan;
    try {
      multipartPlan = buildMultipartPlan(fileSize);
    } catch {
      return res.status(413).json({ message: "File exceeds maximum multipart size (5TB)" });
    }

    const cost = calcUploadCost(fileSize);
    const deductedUser = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        balance: { $gte: cost },
      },
      { $inc: { balance: -cost } },
      { new: true }
    );

    if (!deductedUser) {
      return res.status(402).json({ message: "Insufficient balance" });
    }

    try {
      objectKey = buildObjectKey(req.user._id.toString(), fileName);
      uploadId = await createMultipartUpload({ objectKey, mimeType });

      const pendingUpload = await PendingUpload.create({
        userId: req.user._id,
        objectKey,
        s3UploadId: uploadId,
        originalName: fileName,
        fileSize,
        mimeType,
        partSize: multipartPlan.partSize,
        totalParts: multipartPlan.totalParts,
        costCharged: cost,
        status: "pending",
      });

      return res.status(201).json({
        upload: {
          id: pendingUpload._id,
          partSize: pendingUpload.partSize,
          totalParts: pendingUpload.totalParts,
          fileSize: pendingUpload.fileSize,
          originalName: pendingUpload.originalName,
        },
        balance: deductedUser.balance,
        authMethod: req.authMethod,
      });
    } catch (error) {
      if (uploadId && objectKey) {
        try {
          await abortMultipartUpload({ objectKey, uploadId });
        } catch {
          // Best effort cleanup: upload may not exist anymore.
        }
      }
      await User.updateOne({ _id: req.user._id }, { $inc: { balance: cost } });
      return res.status(500).json({
        message: "Failed to initiate upload and balance was rolled back",
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
);

app.post(
  "/api/files/upload/:fileId/presign",
  requireUploadAuth,
  validateBody(presignMultipartSchema),
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.fileId)) {
      return res.status(400).json({ message: "Invalid upload id" });
    }

    const pendingUpload = await PendingUpload.findOne({
      _id: req.params.fileId,
      userId: req.user._id,
      status: "pending",
    });

    if (!pendingUpload) {
      return res.status(404).json({ message: "Pending upload not found" });
    }

    const partNumbers = Array.from(new Set(req.body.partNumbers)).sort((a, b) => a - b);
    const hasOutOfRangePart = partNumbers.some((partNumber) => partNumber > pendingUpload.totalParts);
    if (hasOutOfRangePart) {
      return res.status(400).json({ message: "Part number exceeds total parts" });
    }

    try {
      const entries = await Promise.all(
        partNumbers.map(async (partNumber) => {
          const url = await getPresignedPartUrl({
            objectKey: pendingUpload.objectKey,
            uploadId: pendingUpload.s3UploadId,
            partNumber,
          });
          return [partNumber, url];
        })
      );
      return res.json({ urls: Object.fromEntries(entries) });
    } catch (error) {
      return res.status(500).json({
        message: "Failed to generate part URLs",
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
);

app.post(
  "/api/files/upload/:fileId/complete",
  requireUploadAuth,
  validateBody(completeMultipartSchema),
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.fileId)) {
      return res.status(400).json({ message: "Invalid upload id" });
    }

    const pendingUpload = await PendingUpload.findOne({
      _id: req.params.fileId,
      userId: req.user._id,
    });

    if (!pendingUpload) {
      return res.status(404).json({ message: "Pending upload not found" });
    }
    if (pendingUpload.status !== "pending") {
      return res.status(409).json({ message: `Upload is already ${pendingUpload.status}` });
    }

    const partMap = new Map();
    for (const part of req.body.parts) {
      if (part.partNumber > pendingUpload.totalParts) {
        return res.status(400).json({ message: "Part number exceeds total parts" });
      }
      partMap.set(part.partNumber, part.etag);
    }

    const sortedParts = [...partMap.entries()]
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);

    try {
      await completeMultipartUpload({
        objectKey: pendingUpload.objectKey,
        uploadId: pendingUpload.s3UploadId,
        parts: sortedParts,
      });

      const file = await FileObject.create({
        userId: req.user._id,
        objectKey: pendingUpload.objectKey,
        originalName: pendingUpload.originalName,
        sizeBytes: pendingUpload.fileSize,
        mimeType: pendingUpload.mimeType,
        costCharged: pendingUpload.costCharged,
      });

      pendingUpload.status = "completed";
      await pendingUpload.save();

      const currentUser = await User.findById(req.user._id).select("balance");
      return res.status(201).json({
        file: {
          id: file._id,
          originalName: file.originalName,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
          costCharged: file.costCharged,
          createdAt: file.createdAt,
        },
        balance: currentUser?.balance ?? req.user.balance,
        authMethod: req.authMethod,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Failed to complete multipart upload",
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
);

app.post("/api/files/upload/:fileId/abort", requireUploadAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.fileId)) {
    return res.status(400).json({ message: "Invalid upload id" });
  }

  const pendingUpload = await PendingUpload.findOne({
    _id: req.params.fileId,
    userId: req.user._id,
  });
  if (!pendingUpload) {
    return res.status(404).json({ message: "Pending upload not found" });
  }
  if (pendingUpload.status !== "pending") {
    return res.status(409).json({ message: `Upload is already ${pendingUpload.status}` });
  }

  try {
    await abortMultipartUpload({
      objectKey: pendingUpload.objectKey,
      uploadId: pendingUpload.s3UploadId,
    });
  } catch {
    // Best effort cleanup: aborted/nonexistent uploads are treated as idempotent.
  }

  pendingUpload.status = "aborted";
  await pendingUpload.save();
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $inc: { balance: pendingUpload.costCharged } },
    { new: true }
  );

  return res.json({
    message: "Multipart upload aborted",
    balance: user?.balance ?? req.user.balance,
  });
});

app.post("/api/files/upload", uploadLimiter, requireUploadAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "File is required" });
  }

  const cost = calcUploadCost(req.file.size);
  const objectKey = buildObjectKey(req.user._id.toString(), req.file.originalname);

  const deductedUser = await User.findOneAndUpdate(
    {
      _id: req.user._id,
      balance: { $gte: cost },
    },
    { $inc: { balance: -cost } },
    { new: true }
  );

  if (!deductedUser) {
    return res.status(402).json({ message: "Insufficient balance" });
  }

  try {
    await uploadToStorage({
      objectKey,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || "application/octet-stream",
    });

    const file = await FileObject.create({
      userId: req.user._id,
      objectKey,
      originalName: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype || "application/octet-stream",
      costCharged: cost,
    });

    return res.status(201).json({
      file: {
        id: file._id,
        originalName: file.originalName,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        costCharged: file.costCharged,
        createdAt: file.createdAt,
      },
      balance: deductedUser.balance,
      authMethod: req.authMethod,
    });
  } catch (error) {
    await User.updateOne({ _id: req.user._id }, { $inc: { balance: cost } });
    return res.status(500).json({
      message: "Upload failed and balance was rolled back",
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
});

app.get("/api/files", requireAuth, async (req, res) => {
  const files = await FileObject.find({ userId: req.user._id }).sort({ createdAt: -1 });
  return res.json(
    files.map((file) => ({
      id: file._id,
      originalName: file.originalName,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      costCharged: file.costCharged,
      createdAt: file.createdAt,
    }))
  );
});

app.get("/api/files/:id/download", requireAuth, async (req, res) => {
  const file = await FileObject.findOne({ _id: req.params.id, userId: req.user._id });
  if (!file) {
    return res.status(404).json({ message: "File not found" });
  }
  const url = await getSignedDownloadUrl(file.objectKey);
  return res.json({ url });
});

app.delete("/api/files/:id", requireAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const file = await FileObject.findOne({ _id: req.params.id, userId: req.user._id }, null, { session });
    if (!file) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "File not found" });
    }

    await FileObject.deleteOne({ _id: file._id }, { session });
    await session.commitTransaction();
    session.endSession();

    await deleteFromStorage(file.objectKey);
    return res.json({ message: "File deleted" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({
      message: "Cannot delete file",
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: `Max file size is ${config.uploadMaxMb}MB` });
  }
  return res.status(500).json({ message: "Internal server error" });
});

async function bootstrap() {
  await connectDatabase();
  await ensureBucketExists();
  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap API", error);
  process.exit(1);
});
