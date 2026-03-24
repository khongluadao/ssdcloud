import test from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, getApiKeyPrefix, hashApiKey } from "../src/services/apiKeys.js";

test("generateApiKey returns sk_ prefix", () => {
  const key = generateApiKey();
  assert.equal(key.startsWith("sk_"), true);
  assert.equal(key.length > 20, true);
});

test("hashApiKey is deterministic", () => {
  const sample = "sk_example";
  assert.equal(hashApiKey(sample), hashApiKey(sample));
});

test("getApiKeyPrefix truncates key", () => {
  const sample = "sk_123456789012345";
  assert.equal(getApiKeyPrefix(sample), "sk_1234567");
});
