import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpectedSubhandleSettingsScriptHash,
  buildSubhandleSettingsDeploymentPlan,
  discoverNextContractSubhandle,
  fetchLiveSubhandleSettingsDeploymentState,
} from "../deploymentPlan.js";

const desiredState = {
  schemaVersion: 1,
  network: "preview",
  contractSlug: "subhandle-settings",
  build: {
    target: "subhandle_settings.helios",
    kind: "validator",
    parameters: {},
  },
  subhandleStrategy: {
    namespace: "handlecontract",
    format: "contract_slug_ordinal",
  },
  settings: {
    type: "subhandle_settings",
    values: {
      sh_settings: "aa",
    },
  },
};

test("expected script hash is read from the repo-native compile path", () => {
  const hash = buildExpectedSubhandleSettingsScriptHash({
    compileFn: () => "ab".repeat(28),
  });

  assert.equal(hash, "ab".repeat(28));
});

test("fetches live subhandle settings deployment state from the Handles API", async () => {
  const requests = [];
  const live = await fetchLiveSubhandleSettingsDeploymentState({
    network: "preview",
    userAgent: "codex-test",
    fetchFn: async (url, init) => {
      requests.push({ url: String(url), headers: init?.headers });
      if (String(url).includes("/scripts?latest=true&type=sub_handle_settings")) {
        return new Response(JSON.stringify({
          validatorHash: "ab".repeat(28),
          handle: "subhandle-settings2@handlecontract",
        }), { status: 200 });
      }
      if (String(url).endsWith("/datum")) {
        return new Response("aa", { status: 200 });
      }
      return new Response(JSON.stringify({ utxo: "tx#0" }), { status: 200 });
    },
  });

  assert.equal(live.currentScriptHash, "ab".repeat(28));
  assert.equal(live.currentSubhandle, "subhandle-settings2@handlecontract");
  assert.deepEqual(live.currentSettingsUtxoRefs, { sh_settings: "tx#0" });
  assert.deepEqual(live.settings, { sh_settings: "aa" });
  assert.equal(requests[0].url, "https://preview.api.handle.me/scripts?latest=true&type=sub_handle_settings");
});

test("builds a no-change deployment plan when live state matches the desired YAML", () => {
  const plan = buildSubhandleSettingsDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "ab".repeat(28),
      currentSubhandle: "subhandle-settings2@handlecontract",
      settings: desiredState.settings.values,
    },
    nextSubhandle: null,
  });

  assert.equal(plan.driftType, "no_change");
  assert.match(plan.summaryMarkdown, /No settings changes/);
});

test("builds a script-and-settings deployment plan when both drift", () => {
  const plan = buildSubhandleSettingsDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "cd".repeat(28),
      currentSubhandle: "sub_settings_01",
      settings: { sh_settings: "bb" },
    },
    nextSubhandle: "subhandle-settings7@handlecontract",
  });

  assert.equal(plan.driftType, "script_hash_and_settings");
  assert.equal(plan.summaryJson.contracts[0].settings.diff_rows[0].handle_name, "sh_settings");
  assert.equal(plan.summaryJson.contracts[0].subhandle.value, "subhandle-settings7@handlecontract");
});

test("marks script drift for manual review when no replacement handle is resolved", () => {
  const plan = buildSubhandleSettingsDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "cd".repeat(28),
      currentSubhandle: "sub_settings_01",
      settings: desiredState.settings.values,
    },
    nextSubhandle: null,
  });

  assert.equal(plan.summaryJson.contracts[0].subhandle.action, "manual_review");
  assert.match(plan.summaryMarkdown, /operator review/i);
});

test("discovers the next available subhandle settings contract SubHandle ordinal", async () => {
  const requested = [];
  const subhandle = await discoverNextContractSubhandle({
    network: "preview",
    contractSlug: "subhandle-settings",
    namespace: "handlecontract",
    userAgent: "codex-test",
    fetchFn: async (url) => {
      requested.push(String(url));
      return new Response("{}", {
        status: String(url).endsWith("subhandle-settings3%40handlecontract") ? 404 : 200,
      });
    },
  });

  assert.equal(subhandle, "subhandle-settings3@handlecontract");
  assert.deepEqual(requested, [
    "https://preview.api.handle.me/handles/subhandle-settings1%40handlecontract",
    "https://preview.api.handle.me/handles/subhandle-settings2%40handlecontract",
    "https://preview.api.handle.me/handles/subhandle-settings3%40handlecontract",
  ]);
});
