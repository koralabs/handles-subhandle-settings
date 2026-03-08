import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpectedSubhandleSettingsScriptHash,
  buildSubhandleSettingsDeploymentPlan,
  decodeShSettingsDatum,
  discoverNextContractSubhandle,
  fetchLiveSubhandleSettingsDeploymentState,
} from "../deploymentPlan.js";

const desiredState = {
  schemaVersion: 2,
  network: "preview",
  contractSlug: "subh",
  scriptType: "subh",
  oldScriptType: "sub_handle_settings",
  deploymentHandleSlug: "subh",
  build: {
    target: "subh.helios",
    kind: "validator",
    parameters: {},
  },
  subhandleStrategy: {
    namespace: "handlecontract",
    format: "contract_slug_ordinal",
  },
  assignedHandles: {
    settings: ["sh_settings"],
    scripts: ["subhsetcont_003"],
  },
  ignoredSettings: [],
  settings: {
    type: "subhandle_settings",
    values: {
      sh_settings: {
        valid_contracts: ["b026528c4d6cc77d4527f8ab794651d0aa3ef2dc06e4f5d7d36c3465"],
        admin_creds: ["0297c358427a84608418ef3501a41cd600cfa1361be2e28998ace35c"],
        virtual_price: 2000000,
        base_price: 5000000,
        buy_down_prices: [[1000000000, 10]],
        payment_address: "30195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66",
        expiry_duration: 31536000000,
        renewal_window: 31535700000,
      },
    },
  },
};

const previewDatum = "9f9f581cb026528c4d6cc77d4527f8ab794651d0aa3ef2dc06e4f5d7d36c3465581c0297c358427a84608418ef3501a41cd600cfa1361be2e28998ace35c581c020c5d23c38087ae006e01926cba57ff0022287f9e6fafeb891b77a0581cf8923bbf64b7b4409b56733c12406363faf40f51edb2be72fd4d2e09ff9f581cb026528c4d6cc77d4527f8ab794651d0aa3ef2dc06e4f5d7d36c3465581c0297c358427a84608418ef3501a41cd600cfa1361be2e28998ace35c581c020c5d23c38087ae006e01926cba57ff0022287f9e6fafeb891b77a0ff1a001e84801a004c4b409f9f1a3b9aca000aff9f1b00000002540be4001819ff9f1b0000000ba43b74001828ff9f1b000000174876e8001832ff9f1b000000746a5288001846ff9f1b000000e8d4a510001855ffff583930195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d66195bde3deacb613b7e9eb6280b14db4e353e475e96d19f3f7a5e2d661b0000000757b12c001b0000000757ac9820ff";

test("expected script hash is read from the repo-native compile path", () => {
  const hash = buildExpectedSubhandleSettingsScriptHash({
    compileFn: () => "ab".repeat(28),
  });

  assert.equal(hash, "ab".repeat(28));
});

test("decodes sh_settings CBOR into named YAML fields", () => {
  const decoded = decodeShSettingsDatum(previewDatum);

  assert.equal(decoded.virtual_price, 2000000);
  assert.deepEqual(decoded.buy_down_prices[0], [1000000000, 10]);
  assert.equal(decoded.payment_address.startsWith("30195bde"), true);
});

test("fetches live subhandle settings deployment state from the Handles API", async () => {
  const requests = [];
  const live = await fetchLiveSubhandleSettingsDeploymentState({
    network: "preview",
    scriptType: desiredState.oldScriptType ?? desiredState.scriptType,
    userAgent: "codex-test",
    fetchFn: async (url, init) => {
      requests.push({ url: String(url), headers: init?.headers });
      if (String(url).includes("/scripts?latest=true&type=sub_handle_settings")) {
        return new Response(JSON.stringify({
          validatorHash: "ab".repeat(28),
          handle: "subhsetcont_003",
        }), { status: 200 });
      }
      if (String(url).endsWith("/datum")) {
        return new Response(previewDatum, { status: 200 });
      }
      return new Response(JSON.stringify({ utxo: "tx#0" }), { status: 200 });
    },
  });

  assert.equal(live.currentScriptHash, "ab".repeat(28));
  assert.equal(live.currentSubhandle, "subhsetcont_003");
  assert.deepEqual(live.currentSettingsUtxoRefs, { sh_settings: "tx#0" });
  assert.equal(live.settings.sh_settings.virtual_price, 2000000);
  assert.equal(requests[0].url, "https://preview.api.handle.me/scripts?latest=true&type=sub_handle_settings");
});

test("builds a no-change deployment plan when live state matches the desired YAML", () => {
  const plan = buildSubhandleSettingsDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "ab".repeat(28),
      currentSubhandle: "subhsetcont_003",
      settings: desiredState.settings.values,
    },
    nextSubhandle: null,
  });

  assert.equal(plan.driftType, "no_change");
  assert.match(plan.summaryMarkdown, /No settings changes/);
  assert.deepEqual(plan.summaryJson.contracts[0].expected_post_deploy_state.assigned_handles.settings, ["sh_settings"]);
});

test("builds a script-and-settings deployment plan when both drift", () => {
  const plan = buildSubhandleSettingsDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "cd".repeat(28),
      currentSubhandle: "subhsetcont_003",
      settings: {
        sh_settings: {
          ...desiredState.settings.values.sh_settings,
          base_price: 1,
        },
      },
    },
    nextSubhandle: "subh7@handlecontract",
  });

  assert.equal(plan.driftType, "script_hash_and_settings");
  assert.equal(plan.summaryJson.contracts[0].settings.diff_rows[0].handle_name, "sh_settings");
  assert.equal(plan.summaryJson.contracts[0].subhandle.value, "subh7@handlecontract");
});

test("marks script drift for manual review when no replacement handle is resolved", () => {
  const plan = buildSubhandleSettingsDeploymentPlan({
    desired: desiredState,
    expectedScriptHash: "ab".repeat(28),
    live: {
      currentScriptHash: "cd".repeat(28),
      currentSubhandle: "subhsetcont_003",
      settings: desiredState.settings.values,
    },
    nextSubhandle: null,
  });

  assert.equal(plan.summaryJson.contracts[0].subhandle.action, "manual_review");
  assert.match(plan.summaryMarkdown, /operator review/i);
});

test("discovers the next available subhandle settings contract SubHandle ordinal from the short deployment slug", async () => {
  const requested = [];
  const subhandle = await discoverNextContractSubhandle({
    network: "preview",
    deploymentHandleSlug: "subh",
    namespace: "handlecontract",
    currentSubhandle: "subh2@handlecontract",
    userAgent: "codex-test",
    fetchFn: async (url) => {
      requested.push(String(url));
      return new Response("{}", {
        status: String(url).endsWith("subh4%40handlecontract") ? 404 : 200,
      });
    },
  });

  assert.equal(subhandle, "subh3@handlecontract");
  assert.deepEqual(requested, [
    "https://preview.api.handle.me/handles/subh1%40handlecontract",
    "https://preview.api.handle.me/handles/subh2%40handlecontract",
    "https://preview.api.handle.me/handles/subh3%40handlecontract",
    "https://preview.api.handle.me/handles/subh4%40handlecontract",
  ]);
});

test("reuses an already minted subhandle-settings replacement handle", async () => {
  const subhandle = await discoverNextContractSubhandle({
    network: "preview",
    deploymentHandleSlug: "subh",
    namespace: "handlecontract",
    currentSubhandle: "subhsetcont_003",
    userAgent: "codex-test",
    fetchFn: async (url) => new Response("{}", {
      status: String(url).endsWith("subh2%40handlecontract") ? 404 : 200,
    }),
  });

  assert.equal(subhandle, "subh1@handlecontract");
});
