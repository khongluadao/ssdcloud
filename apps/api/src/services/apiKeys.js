import crypto from "node:crypto";
import { sha256 } from "./tokens.js";

export function generateApiKey() {
  return `sk_${crypto.randomBytes(24).toString("hex")}`;
}

export function hashApiKey(rawKey) {
  return sha256(rawKey);
}

export function getApiKeyPrefix(rawKey) {
  return rawKey.slice(0, 10);
}
