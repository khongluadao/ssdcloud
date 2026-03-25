import mongoose from "mongoose";

const pendingUploadSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    objectKey: { type: String, required: true, unique: true },
    s3UploadId: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true },
    partSize: { type: Number, required: true, min: 5 * 1024 * 1024 },
    totalParts: { type: Number, required: true, min: 1, max: 10_000 },
    costCharged: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "completed", "aborted"],
      default: "pending",
      index: true,
    },
    authMethod: { type: String, enum: ["jwt", "api_key"], required: true },
    apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", default: null, index: true },
    apiKeyPrefix: { type: String, default: null },
    clientIp: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

pendingUploadSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });
pendingUploadSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const PendingUpload = mongoose.model("PendingUpload", pendingUploadSchema);
