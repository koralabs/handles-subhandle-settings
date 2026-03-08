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
  const state = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/preview/subhandle-settings.yaml")
  );

  assert.equal(state.schemaVersion, 1);
  assert.equal(state.network, "preview");
  assert.equal(state.contractSlug, "subhandle-settings");
  assert.equal(state.settings.values.sh_settings.startsWith("9f9f581c"), true);
});

test("loads the preprod and mainnet desired deployment YAML fixtures", async () => {
  const preprod = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/preprod/subhandle-settings.yaml")
  );
  const mainnet = await loadDesiredDeploymentState(
    path.resolve(__dirname, "../deploy/mainnet/subhandle-settings.yaml")
  );

  assert.equal(preprod.network, "preprod");
  assert.equal(mainnet.network, "mainnet");
  assert.equal(preprod.settings.values.sh_settings.endsWith("9820ff"), true);
  assert.equal(mainnet.settings.values.sh_settings.endsWith("9820ff"), true);
});

test("rejects observed-only live fields inside desired deployment YAML", () => {
  assert.throws(
    () => parseDesiredDeploymentState(`
schema_version: 1
network: preview
contract_slug: subhandle-settings
build:
  target: subhandle_settings.helios
  kind: validator
  parameters: {}
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
current_script_hash: deadbeef
settings:
  type: subhandle_settings
  values:
    sh_settings: aa
`, "invalid fixture"),
    /must not include observed-only field `current_script_hash`/
  );
});
