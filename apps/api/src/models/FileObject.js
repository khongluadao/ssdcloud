import mongoose from "mongoose";

const fileObjectSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    objectKey: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true },
    costCharged: { type: Number, required: true, min: 0 },
    authMethod: { type: String, enum: ["jwt", "api_key"], required: true },
    apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", default: null, index: true },
    apiKeyPrefix: { type: String, default: null },
    clientIp: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

export const FileObject = mongoose.model("FileObject", fileObjectSchema);
