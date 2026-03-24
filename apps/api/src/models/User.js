import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    balance: { type: Number, required: true, default: 0, min: 0 },
    refreshTokenHash: { type: String, default: null },
    roles: { type: [String], default: ["user"] },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
