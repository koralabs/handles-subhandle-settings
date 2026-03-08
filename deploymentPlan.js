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
      [SETTINGS_HANDLE]: (await datumResponse.text()).trim(),
    },
  };
};

export const discoverNextContractSubhandle = async ({
  network,
  contractSlug,
  namespace,
  userAgent,
  fetchFn = fetch,
}) => {
  const baseUrl = handlesApiBaseUrlForNetwork(network);
  for (let ordinal = 1; ordinal < 10000; ordinal += 1) {
    const candidate = `${contractSlug}${ordinal}@${namespace}`;
    const response = await fetchFn(
      `${baseUrl}/handles/${encodeURIComponent(candidate)}`,
      { headers: { "User-Agent": userAgent } }
    );
    if (response.status === 404) return candidate;
    if (!response.ok) {
      throw new Error(`failed to probe SubHandle ${candidate}: HTTP ${response.status}`);
    }
  }
  throw new Error(`no available SubHandle found for ${contractSlug}@${namespace}`);
};

export const buildSubhandleSettingsDeploymentPlan = ({
  desired,
  expectedScriptHash,
  live,
  nextSubhandle,
}) => {
  const settingsDiffRows = live.settings.sh_settings === desired.settings.values.sh_settings
    ? []
    : [{
        handle_name: SETTINGS_HANDLE,
        current: live.settings.sh_settings,
        desired: desired.settings.values.sh_settings,
      }];

  const scriptChanged = live.currentScriptHash !== expectedScriptHash;
  const settingsChanged = settingsDiffRows.length > 0;
  const driftType = scriptChanged && settingsChanged
    ? "script_hash_and_settings"
    : scriptChanged
      ? "script_hash_only"
      : settingsChanged
        ? "settings_only"
        : "no_change";

  const plannedSubhandle = scriptChanged
    ? nextSubhandle || live.currentSubhandle || `${desired.contractSlug}@${desired.subhandleStrategy.namespace}`
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
    settings: {
      type: desired.settings.type,
      values: desired.settings.values,
    },
  };

  const planId = crypto.createHash("sha256").update(JSON.stringify({
    network: desired.network,
    contract_slug: desired.contractSlug,
    current_script_hash: live.currentScriptHash,
    expected_script_hash: expectedScriptHash,
    current_settings: live.settings,
    desired_settings: desired.settings.values,
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
