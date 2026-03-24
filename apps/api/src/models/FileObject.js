import mongoose from "mongoose";

const fileObjectSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    objectKey: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true },
    costCharged: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

export const FileObject = mongoose.model("FileObject", fileObjectSchema);
