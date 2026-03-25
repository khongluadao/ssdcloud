import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomApiKey, generateApiKey, getApiKeyPrefix, hashApiKey } from "../src/services/apiKeys.js";

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

test("buildCustomApiKey normalizes uk_ prefix", () => {
  assert.equal(buildCustomApiKey("my_upload_key"), "uk_my_upload_key");
  assert.equal(buildCustomApiKey("uk_my_upload_key"), "uk_my_upload_key");
});

test("buildCustomApiKey validates allowed charset", () => {
  assert.throws(() => buildCustomApiKey("bad key with spaces"));
});
