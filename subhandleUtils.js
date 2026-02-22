import { AssetNameLabel } from "@koralabs/kora-labs-common";

export const normalizeSubhandle = (value) => value.trim().toLowerCase();

export const toHexUtf8 = (value) =>
  Buffer.from(normalizeSubhandle(value), "utf8").toString("hex");

export const buildReferenceAssetName = (subhandle) =>
  `${AssetNameLabel.LBL_100}${toHexUtf8(subhandle)}`;

export const isNonNegativeInt = (value) =>
  Number.isInteger(value) && value >= 0;

