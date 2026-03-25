import crypto from "node:crypto";
import { sha256 } from "./tokens.js";

export const RANDOM_API_KEY_PREFIX = "sk_";
export const CUSTOM_API_KEY_PREFIX = "uk_";

export function generateApiKey() {
  return `${RANDOM_API_KEY_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
}

export function buildCustomApiKey(rawInput) {
  const input = String(rawInput ?? "").trim();
  if (!input) {
    throw new Error("Custom API key is required");
  }

  const normalized = input.startsWith(CUSTOM_API_KEY_PREFIX) ? input : `${CUSTOM_API_KEY_PREFIX}${input}`;
  const suffix = normalized.slice(CUSTOM_API_KEY_PREFIX.length);
  if (suffix.length < 4 || suffix.length > 64) {
    throw new Error("Custom API key must be 4-64 chars (excluding uk_ prefix)");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(suffix)) {
    throw new Error("Custom API key only allows letters, numbers, '_' and '-'");
  }
  return normalized;
}

export function hashApiKey(rawKey) {
  return sha256(rawKey);
}

export function getApiKeyPrefix(rawKey) {
  return rawKey.slice(0, 10);
}
