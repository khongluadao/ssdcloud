import test from "node:test";
import assert from "node:assert/strict";
import {
  clampShareTtlSeconds,
  computeSignedDownloadTtlSeconds,
  isShareExpired,
} from "../src/services/shareLinks.js";

const sampleConfig = {
  downloadLinkDefaultTtlSeconds: 21600,
  downloadLinkMinTtlSeconds: 60,
  downloadLinkMaxTtlSeconds: 604800,
};

test("clampShareTtlSeconds uses 6h default", () => {
  assert.equal(clampShareTtlSeconds(undefined, sampleConfig), 21600);
});

test("clampShareTtlSeconds clamps below minimum", () => {
  assert.equal(clampShareTtlSeconds(10, sampleConfig), 60);
});

test("clampShareTtlSeconds clamps above maximum", () => {
  assert.equal(clampShareTtlSeconds(9999999, sampleConfig), 604800);
});

test("isShareExpired checks expiry", () => {
  const now = Date.now();
  assert.equal(isShareExpired(new Date(now - 1000), now), true);
  assert.equal(isShareExpired(new Date(now + 1000), now), false);
});

test("computeSignedDownloadTtlSeconds uses remaining and max cap", () => {
  const now = Date.now();
  assert.equal(computeSignedDownloadTtlSeconds(new Date(now + 10_000), 3600, now), 10);
  assert.equal(computeSignedDownloadTtlSeconds(new Date(now + 10_000_000), 3600, now), 3600);
});
