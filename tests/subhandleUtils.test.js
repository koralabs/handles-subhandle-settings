import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceAssetName,
  isNonNegativeInt,
  normalizeSubhandle,
  toHexUtf8,
} from "../subhandleUtils.js";

test("normalizeSubhandle trims and lowercases", () => {
  assert.equal(normalizeSubhandle("  My.Sub  "), "my.sub");
});

test("toHexUtf8 encodes normalized string as hex", () => {
  assert.equal(toHexUtf8(" TeSt "), Buffer.from("test").toString("hex"));
});

test("buildReferenceAssetName prefixes encoded subhandle with 100 label", () => {
  const assetName = buildReferenceAssetName("XAR");
  assert.equal(assetName.startsWith("000643b0"), true);
  assert.equal(assetName.endsWith(Buffer.from("xar").toString("hex")), true);
});

test("isNonNegativeInt accepts only whole numbers >= 0", () => {
  assert.equal(isNonNegativeInt(0), true);
  assert.equal(isNonNegativeInt(5), true);
  assert.equal(isNonNegativeInt(-1), false);
  assert.equal(isNonNegativeInt(1.1), false);
});

