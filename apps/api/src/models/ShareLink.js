import mongoose from "mongoose";

const whitelistEntrySchema = new mongoose.Schema(
  {
    ip: { type: String, required: true, trim: true },
    unlockedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    unlockedAt: { type: Date, required: true, default: Date.now },
    lastUsedAt: { type: Date, default: null },
  },
  { _id: false }
);

const shareLinkSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "FileObject", required: true, unique: true, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    isActive: { type: Boolean, default: true },
    downloadCostToken: { type: Number, required: true, min: 0, default: 0 },
    expiresAt: { type: Date, required: true, index: true },
    whitelistIps: { type: [whitelistEntrySchema], default: [] },
  },
  { timestamps: true }
);

shareLinkSchema.index({ ownerUserId: 1, createdAt: -1 });

export const ShareLink = mongoose.model("ShareLink", shareLinkSchema);
