import crypto from "node:crypto";
import fs from "node:fs";

import * as helios from "@koralabs/helios";

const REPO_NAME = "handles-subhandle-settings";
const SETTINGS_HANDLE = "sh_settings";

const handlesApiBaseUrlForNetwork = (network) => {
  if (network === "preview") return "https://preview.api.handle.me";
  if (network === "preprod") return "https://preprod.api.handle.me";
  return "https://api.handle.me";
};

export const compileSubhandleSettingsValidator = () => {
  const source = fs.readFileSync("./subhandle_settings.helios", "utf8");
  const program = helios.Program.new(source);
  return program.compile().validatorHash.hex;
};

export const buildExpectedSubhandleSettingsScriptHash = ({
  compileFn = compileSubhandleSettingsValidator,
} = {}) => String(compileFn()).trim();

export const decodeShSettingsDatum = (datumHex) => {
  const fields = requireListData(
    helios.UplcData.fromCbor(stripHexPrefix(datumHex)),
    "sh_settings datum"
  );
  if (fields.length !== 8) {
    throw new Error(`sh_settings datum must contain 8 fields, received ${fields.length}`);
  }
  return {
    valid_contracts: requireListData(fields[0], "valid_contracts").map((value) =>
      requireByteArray(value, "valid_contracts item")
    ),
    admin_creds: requireListData(fields[1], "admin_creds").map((value) =>
      requireByteArray(value, "admin_creds item")
    ),
    virtual_price: requireInt(fields[2], "virtual_price"),
    base_price: requireInt(fields[3], "base_price"),
    buy_down_prices: requireListData(fields[4], "buy_down_prices").map((pair, index) => {
      const values = requireListData(pair, `buy_down_prices[${index}]`);
      if (values.length !== 2) {
        throw new Error(`buy_down_prices[${index}] must contain exactly two ints`);
      }
      return values.map((value, offset) => requireInt(value, `buy_down_prices[${index}][${offset}]`));
    }),
    payment_address: requireByteArray(fields[5], "payment_address"),
    expiry_duration: requireInt(fields[6], "expiry_duration"),
    renewal_window: requireInt(fields[7], "renewal_window"),
  };
};

export const fetchLiveSubhandleSettingsDeploymentState = async ({
  network,
  userAgent,
  fetchFn = fetch,
}) => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  const headers = { "User-Agent": userAgent };
  const scriptResponse = await fetchFn(
    `${baseUrl}/scripts?latest=true&type=sub_handle_settings`,
    { headers }
  );
  if (!scriptResponse.ok) {
    throw new Error(`failed to load live subhandle settings script: HTTP ${scriptResponse.status}`);
  }
  const scriptPayload = await scriptResponse.json();
  const currentScriptHash = String(
    scriptPayload.validatorHash ?? scriptPayload.scriptHash ?? ""
  ).trim();
  if (!currentScriptHash) {
    throw new Error("live subhandle settings script response missing validatorHash/scriptHash");
  }

  const handleResponse = await fetchFn(`${baseUrl}/handles/${SETTINGS_HANDLE}`, { headers });
  if (!handleResponse.ok) {
    throw new Error(`failed to load handle ${SETTINGS_HANDLE}: HTTP ${handleResponse.status}`);
  }
  const handlePayload = await handleResponse.json();

  const datumResponse = await fetchFn(`${baseUrl}/handles/${SETTINGS_HANDLE}/datum`, { headers });
  if (!datumResponse.ok) {
    throw new Error(`failed to load datum for ${SETTINGS_HANDLE}: HTTP ${datumResponse.status}`);
  }

  const currentSettingsUtxoRef = String(handlePayload.utxo ?? "").trim() || null;
  return {
    currentScriptHash,
    currentSubhandle: String(scriptPayload.handle ?? "").trim() || null,
    currentSettingsUtxoRefs: currentSettingsUtxoRef ? { [SETTINGS_HANDLE]: currentSettingsUtxoRef } : {},
    settings: {
      [SETTINGS_HANDLE]: decodeShSettingsDatum((await datumResponse.text()).trim()),
    },
  };
};

export const discoverNextContractSubhandle = async ({
  network,
  deploymentHandleSlug,
  namespace,
  userAgent,
  fetchFn = fetch,
}) => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  for (let ordinal = 1; ordinal < 10000; ordinal += 1) {
    const candidate = `${deploymentHandleSlug}${ordinal}@${namespace}`;
    const response = await fetchFn(
      `${baseUrl}/handles/${encodeURIComponent(candidate)}`,
      { headers: { "User-Agent": userAgent } }
    );
    if (response.status === 404) return candidate;
    if (!response.ok) {
      throw new Error(`failed to probe SubHandle ${candidate}: HTTP ${response.status}`);
    }
  }
  throw new Error(`no available SubHandle found for ${deploymentHandleSlug}@${namespace}`);
};

export const buildSubhandleSettingsDeploymentPlan = ({
  desired,
  expectedScriptHash,
  live,
  nextSubhandle,
}) => {
  const settingsChanged =
    stableStringify(live.settings.sh_settings) !==
    stableStringify(desired.settings.values.sh_settings);
  const settingsDiffRows = settingsChanged
    ? [{
        handle_name: SETTINGS_HANDLE,
        current: live.settings.sh_settings,
        desired: desired.settings.values.sh_settings,
      }]
    : [];

  const scriptChanged = live.currentScriptHash !== expectedScriptHash;
  const driftType = scriptChanged && settingsChanged
    ? "script_hash_and_settings"
    : scriptChanged
      ? "script_hash_only"
      : settingsChanged
        ? "settings_only"
        : "no_change";

  const plannedSubhandle = scriptChanged
    ? nextSubhandle || live.currentSubhandle || `${desired.deploymentHandleSlug}@${desired.subhandleStrategy.namespace}`
    : live.currentSubhandle;
  if (!plannedSubhandle) {
    throw new Error("deployment plan requires a resolved SubHandle");
  }

  const subhandleAction = scriptChanged ? (nextSubhandle ? "allocate" : "manual_review") : "reuse";
  const expectedPostDeployState = {
    repo: REPO_NAME,
    network: desired.network,
    contract_slug: desired.contractSlug,
    expected_script_hash: expectedScriptHash,
    expected_subhandle: plannedSubhandle,
    assigned_handles: {
      settings: desired.assignedHandles.settings,
      scripts: scriptChanged ? [plannedSubhandle] : desired.assignedHandles.scripts,
    },
    settings: {
      type: desired.settings.type,
      values: desired.settings.values,
      ignored_paths: desired.ignoredSettings,
    },
  };

  const planId = crypto.createHash("sha256").update(stableStringify({
    network: desired.network,
    contract_slug: desired.contractSlug,
    current_script_hash: live.currentScriptHash,
    expected_script_hash: expectedScriptHash,
    current_settings: live.settings,
    desired_settings: desired.settings.values,
    assigned_handles: desired.assignedHandles,
    ignored_settings: desired.ignoredSettings,
    planned_subhandle: plannedSubhandle,
  })).digest("hex");

  const summaryJson = {
    plan_id: planId,
    repo: REPO_NAME,
    network: desired.network,
    contracts: [{
      contract_slug: desired.contractSlug,
      drift_type: driftType,
      script_hashes: {
        current: live.currentScriptHash,
        expected: expectedScriptHash,
      },
      settings: {
        type: desired.settings.type,
        diff_rows: settingsDiffRows,
        desired_values: desired.settings.values,
        ignored_paths: desired.ignoredSettings,
      },
      subhandle: {
        action: subhandleAction,
        value: plannedSubhandle,
        is_new: scriptChanged && Boolean(nextSubhandle),
      },
      expected_post_deploy_state: expectedPostDeployState,
    }],
    transaction_order: [],
  };

  const summaryMarkdown = [
    "# Contract Deployment Plan",
    "",
    `- Plan ID: \`${planId}\``,
    `- Repo: \`${REPO_NAME}\``,
    `- Network: \`${desired.network}\``,
    `- Contract: \`${desired.contractSlug}\``,
    `- Drift Type: \`${driftType}\``,
    `- Script Hash: \`${live.currentScriptHash}\` -> \`${expectedScriptHash}\``,
    `- SubHandle: \`${plannedSubhandle}\``,
    "",
    "## Settings Drift",
    ...(settingsDiffRows.length > 0 ? ["- `sh_settings`"] : ["- No settings changes."]),
    "",
    "## Transaction Order",
    "- No transaction artifact is generated for this repo yet.",
    ...(subhandleAction === "manual_review"
      ? ["- Script drift requires operator review of the replacement deployment handle namespace."]
      : []),
  ].join("\n");

  return {
    planId,
    driftType,
    summaryJson,
    summaryMarkdown,
    deploymentPlanJson: {
      plan_id: planId,
      repo: REPO_NAME,
      network: desired.network,
      contracts: [expectedPostDeployState],
      transaction_order: [],
    },
  };
};

const requireListData = (value, label) => {
  if (!value || !Array.isArray(value.list)) {
    throw new Error(`${label} must decode to a list`);
  }
  return value.list;
};

const requireByteArray = (value, label) => {
  if (!value || typeof value.hex !== "string") {
    throw new Error(`${label} must decode to a byte array`);
  }
  return value.hex;
};

const requireInt = (value, label) => {
  if (!value || (typeof value.value !== "bigint" && typeof value.value !== "number")) {
    throw new Error(`${label} must decode to an int`);
  }
  return Number(value.value);
};

const stripHexPrefix = (value) => value.startsWith("0x") ? value.slice(2) : value;

const normalizeStable = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeStable);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeStable(nested)])
    );
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(normalizeStable(value));
