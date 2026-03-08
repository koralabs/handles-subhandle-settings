import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadDesiredDeploymentState,
  parseDesiredDeploymentState,
} from "../deploymentState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("loads the preview desired deployment YAML fixture into the normalized shape", async () => {
  // Feature: desired deployment state stores decoded comparable subhandle admin settings plus assigned Handles.
  // Failure mode: the planner would diff against raw CBOR or drop the legacy script handle binding needed for deployment tracking.
  const state = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/preview/subhandle-settings.yaml")
  );

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.network, "preview");
  assert.equal(state.contractSlug, "subh");
  assert.equal(state.scriptType, "subh");
  assert.equal(state.oldScriptType, "sub_handle_settings");
  assert.equal(state.deploymentHandleSlug, "subh");
  assert.deepEqual(state.assignedHandles.settings, ["sh_settings"]);
  assert.deepEqual(state.assignedHandles.scripts, ["subhsetcont_003"]);
  assert.equal(state.settings.values.sh_settings.virtual_price, 2000000);
  assert.equal(state.settings.values.sh_settings.payment_address.startsWith("30195bde"), true);
});

test("loads the preprod and mainnet desired deployment YAML fixtures", async () => {
  // Feature: rollout coverage includes committed desired-state inputs for all intended subhandle-settings networks.
  // Failure mode: workflow push/PR runs would silently skip a network or compare against stale raw-CBOR fixtures.
  const preprod = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/preprod/subhandle-settings.yaml")
  );
  const mainnet = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/mainnet/subhandle-settings.yaml")
  );

  assert.equal(preprod.network, "preprod");
  assert.equal(mainnet.network, "mainnet");
  assert.equal(preprod.assignedHandles.scripts[0], "subhsetcont_003");
  assert.equal(mainnet.assignedHandles.scripts[0], "sub_settings_01");
  assert.equal(preprod.settings.values.sh_settings.valid_contracts.length, 3);
  assert.equal(mainnet.settings.values.sh_settings.admin_creds.length, 1);
});

test("rejects observed-only live fields inside desired deployment YAML", () => {
  assert.throws(
    () => parseDesiredDeploymentState(`
schema_version: 2
network: preview
contract_slug: subh
script_type: subh
old_script_type: sub_handle_settings
deployment_handle_slug: subh
build:
  target: subh.helios
  kind: validator
  parameters: {}
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
current_script_hash: deadbeef
assigned_handles:
  settings: [sh_settings]
  scripts: [subhsetcont_003]
ignored_settings: []
settings:
  type: subhandle_settings
  values:
    sh_settings:
      valid_contracts: []
      admin_creds: []
      virtual_price: 1
      base_price: 2
      buy_down_prices: []
      payment_address: aa
      expiry_duration: 3
      renewal_window: 4
`, "invalid fixture"),
    /must not include observed-only field `current_script_hash`/
  );
});

test("rejects deployment handle slugs longer than 10 characters", () => {
  assert.throws(
    () => parseDesiredDeploymentState(`
schema_version: 2
network: preview
contract_slug: subh
script_type: subh
old_script_type: sub_handle_settings
deployment_handle_slug: subhandleset
build:
  target: subh.helios
  kind: validator
  parameters: {}
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
assigned_handles:
  settings: [sh_settings]
  scripts: [subhsetcont_003]
ignored_settings: []
settings:
  type: subhandle_settings
  values:
    sh_settings:
      valid_contracts: []
      admin_creds: []
      virtual_price: 1
      base_price: 2
      buy_down_prices: []
      payment_address: aa
      expiry_duration: 3
      renewal_window: 4
`, "invalid fixture"),
    /must be 10 characters or fewer/
  );
});
