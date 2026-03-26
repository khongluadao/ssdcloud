import mongoose from "mongoose";

const downloadUnlockSchema = new mongoose.Schema(
  {
    shareLinkId: { type: mongoose.Schema.Types.ObjectId, ref: "ShareLink", required: true, index: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "FileObject", required: true, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    payerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientIp: { type: String, required: true, trim: true },
    chargedAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["charged", "already_whitelisted"], required: true },
  },
  { timestamps: true }
);

downloadUnlockSchema.index({ shareLinkId: 1, payerUserId: 1, createdAt: -1 });

export const DownloadUnlock = mongoose.model("DownloadUnlock", downloadUnlockSchema);
