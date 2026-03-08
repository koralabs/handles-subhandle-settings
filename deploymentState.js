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

  if (requireNumber(parsed, "schema_version", sourceLabel) !== 2) {
    throw new Error(`${sourceLabel} schema_version must equal 2`);
  }

  const network = requireString(parsed, "network", sourceLabel);
  if (!ALLOWED_NETWORKS.has(network)) {
    throw new Error(`${sourceLabel} network must be one of preview, preprod, mainnet`);
  }

  const contractSlug = requireString(parsed, "contract_slug", sourceLabel);
  const build = requireObject(parsed, "build", sourceLabel);
  const subhandleStrategy = requireObject(parsed, "subhandle_strategy", sourceLabel);
  const settings = requireObject(parsed, "settings", sourceLabel);
  const assignedHandles = requireObject(parsed, "assigned_handles", sourceLabel);

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
    schemaVersion: 2,
    network,
    contractSlug,
    deploymentHandleSlug: requireShortHandleSlug(parsed, "deployment_handle_slug", sourceLabel),
    build: {
      target: requireString(build, "target", `${sourceLabel}.build`),
      kind: buildKind,
      parameters: requireObject(build, "parameters", `${sourceLabel}.build`),
    },
    subhandleStrategy: {
      namespace: requireString(subhandleStrategy, "namespace", `${sourceLabel}.subhandle_strategy`),
      format: subhandleFormat,
    },
    assignedHandles: {
      settings: requireStringArrayAllowEmpty(assignedHandles, "settings", `${sourceLabel}.assigned_handles`),
      scripts: requireStringArrayAllowEmpty(assignedHandles, "scripts", `${sourceLabel}.assigned_handles`),
    },
    ignoredSettings: requireStringArrayAllowEmpty(parsed, "ignored_settings", sourceLabel),
    settings: {
      type: requireString(settings, "type", `${sourceLabel}.settings`),
      values: {
        sh_settings: parseShSettings(
          requireObject(requireObject(settings, "values", `${sourceLabel}.settings`), "sh_settings", `${sourceLabel}.settings.values`),
          `${sourceLabel}.settings.values.sh_settings`
        ),
      },
    },
  };
};

const parseShSettings = (value, sourceLabel) => ({
  valid_contracts: requireStringArrayAllowEmpty(value, "valid_contracts", sourceLabel),
  admin_creds: requireStringArrayAllowEmpty(value, "admin_creds", sourceLabel),
  virtual_price: requireNumber(value, "virtual_price", sourceLabel),
  base_price: requireNumber(value, "base_price", sourceLabel),
  buy_down_prices: requireNumberPairs(value, "buy_down_prices", sourceLabel),
  payment_address: requireString(value, "payment_address", sourceLabel),
  expiry_duration: requireNumber(value, "expiry_duration", sourceLabel),
  renewal_window: requireNumber(value, "renewal_window", sourceLabel),
});

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

const requireStringArrayAllowEmpty = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (!Array.isArray(resolved)) {
    throw new Error(`${sourceLabel} must include array field \`${key}\``);
  }
  return resolved.map((item) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`${sourceLabel} must include string array field \`${key}\``);
    }
    return item.trim();
  });
};

const requireNumberPairs = (value, key, sourceLabel) => {
  const resolved = value[key];
  if (!Array.isArray(resolved)) {
    throw new Error(`${sourceLabel} must include array field \`${key}\``);
  }
  return resolved.map((pair, index) => {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error(`${sourceLabel}.${key}[${index}] must contain exactly two numbers`);
    }
    return pair.map((item) => {
      if (typeof item !== "number" || Number.isNaN(item)) {
        throw new Error(`${sourceLabel}.${key}[${index}] must contain exactly two numbers`);
      }
      return item;
    });
  });
};

const requireShortHandleSlug = (value, key, sourceLabel) => {
  const resolved = requireString(value, key, sourceLabel);
  if (resolved.length > 10) {
    throw new Error(`${sourceLabel}.${key} must be 10 characters or fewer`);
  }
  if (resolved.includes("-") || resolved.includes("_")) {
    throw new Error(`${sourceLabel}.${key} must not include separators`);
  }
  return resolved;
};
