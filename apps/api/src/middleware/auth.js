import { ApiKey } from "../models/ApiKey.js";
import { User } from "../models/User.js";
import { hashApiKey } from "../services/apiKeys.js";
import { verifyAccessToken } from "../services/tokens.js";

async function resolveUserByJwt(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice(7);
  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  return user ? { user, method: "jwt" } : null;
}

async function resolveUserByApiKey(req) {
  const rawApiKey = req.headers["x-api-key"];
  if (!rawApiKey || typeof rawApiKey !== "string") {
    return null;
  }
  const keyHash = hashApiKey(rawApiKey);
  const key = await ApiKey.findOne({ keyHash, revokedAt: null });
  if (!key) {
    return null;
  }
  const user = await User.findById(key.userId);
  if (!user) {
    return null;
  }
  key.lastUsedAt = new Date();
  await key.save();
  return { user, method: "api_key" };
}

export async function requireAuth(req, res, next) {
  try {
    const result = await resolveUserByJwt(req);
    if (!result) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = result.user;
    req.authMethod = result.method;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export async function requireUploadAuth(req, res, next) {
  try {
    const jwtResult = await resolveUserByJwt(req);
    const keyResult = jwtResult ? null : await resolveUserByApiKey(req);
    const result = jwtResult || keyResult;
    if (!result) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = result.user;
    req.authMethod = result.method;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid credentials" });
  }
}
