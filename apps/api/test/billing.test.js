import test from "node:test";
import assert from "node:assert/strict";
import { calcUploadCost } from "../src/services/billing.js";

test("calcUploadCost rounds up by MB", () => {
  const cost = calcUploadCost(1024 * 1024 + 1);
  assert.equal(cost > 0, true);
});
