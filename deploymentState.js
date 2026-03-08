import fs from "node:fs/promises";

import YAML from "yaml";

const ALLOWED_NETWORKS = new Set(["preview", "preprod", "mainnet"]);
const OBSERVED_ONLY_FIELDS = new Set([
  "current_script_hash",
  "current_settings_utxo_ref",
  "current_subhandle",
  "observed_at",
  "last_deployed_tx_hash",
]);

export const loadDesiredDeploymentState = async (path) => {
  const raw = await fs.readFile(path, "utf8");
  return parseDesiredDeploymentState(raw, path);
};

export const parseDesiredDeploymentState = (
  raw,
  sourceLabel = "desired deployment state"
) => {
  let parsed;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new Error(
      `${sourceLabel} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourceLabel} must be a YAML object`);
  }

  const observedOnlyField = Object.keys(parsed).find((key) => OBSERVED_ONLY_FIELDS.has(key));
  if (observedOnlyField) {
    throw new Error(`${sourceLabel} must not include observed-only field \`${observedOnlyField}\``);
  }

  if (requireNumber(parsed, "schema_version", sourceLabel) !== 1) {
    throw new Error(`${sourceLabel} schema_version must equal 1`);
  }

  const network = requireString(parsed, "network", sourceLabel);
  if (!ALLOWED_NETWORKS.has(network)) {
    throw new Error(`${sourceLabel} network must be one of preview, preprod, mainnet`);
  }

  const contractSlug = requireString(parsed, "contract_slug", sourceLabel);
  const build = requireObject(parsed, "build", sourceLabel);
  const subhandleStrategy = requireObject(parsed, "subhandle_strategy", sourceLabel);
  const settings = requireObject(parsed, "settings", sourceLabel);

  const buildKind = requireString(build, "kind", `${sourceLabel}.build`);
  if (buildKind !== "validator") {
    throw new Error(`${sourceLabel}.build kind must be validator`);
  }

  const subhandleFormat = requireString(
    subhandleStrategy,
    "format",
    `${sourceLabel}.subhandle_strategy`
  );
  if (subhandleFormat !== "contract_slug_ordinal") {
    throw new Error(`${sourceLabel}.subhandle_strategy format must be contract_slug_ordinal`);
  }

  return {
    schemaVersion: 1,
    network,
    contractSlug,
    build: {
      target: requireString(build, "target", `${sourceLabel}.build`),
      kind: buildKind,
      parameters: requireObject(build, "parameters", `${sourceLabel}.build`),
    },
    subhandleStrategy: {
      namespace: requireString(subhandleStrategy, "namespace", `${sourceLabel}.subhandle_strategy`),
      format: subhandleFormat,
    },
    settings: {
      type: requireString(settings, "type", `${sourceLabel}.settings`),
      values: {
        sh_settings: requireString(requireObject(settings, "values", `${sourceLabel}.settings`), "sh_settings", `${sourceLabel}.settings.values`),
      },
    },
  };
};

const requireObject = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error(`${sourceLabel} must include object field \`${key}\``);
  }
  return resolved;
};

const requireString = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (typeof resolved !== "string" || resolved.trim() === "") {
    throw new Error(`${sourceLabel} must include string field \`${key}\``);
  }
  return resolved.trim();
};

const requireNumber = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (typeof resolved !== "number" || Number.isNaN(resolved)) {
    throw new Error(`${sourceLabel} must include numeric field \`${key}\``);
  }
  return resolved;
};
