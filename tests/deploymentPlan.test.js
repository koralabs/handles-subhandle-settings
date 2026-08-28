import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as helios from "@koralabs/helios";

import {
  buildSubhandleSettingsDeploymentTxArtifact,
  buildExpectedSubhandleSettingsScriptHash,
  buildSubhandleSettingsDeploymentPlan,
  decodeShSettingsDatum,
  discoverNextContractSubhandle,
  fetchLiveSubhandleSettingsDeploymentState,
  renderTransactionOrderMarkdown,
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

const restoreEnv = (key, value) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

const byteArray = (hex) => new helios.ByteArrayData([...Buffer.from(hex, "hex")]);
const intData = (value) => new helios.IntData(BigInt(value));
const datumHex = (fields) => Buffer.from(new helios.ListData(fields).toCbor()).toString("hex");

const validDatumFields = () => [
  new helios.ListData([byteArray("01")]),
  new helios.ListData([byteArray("02")]),
  intData(1),
  intData(2),
  new helios.ListData([new helios.ListData([intData(3), intData(4)])]),
  byteArray("05"),
  intData(6),
  intData(7),
];

test("expected script hash is read from the repo-native compile path", () => {
  const hash = buildExpectedSubhandleSettingsScriptHash({
    compileFn: () => "ab".repeat(28),
  });

  assert.equal(hash, "ab".repeat(28));
});

test("expected script hash compiles from the repo-native validator source", () => {
  const hash = buildExpectedSubhandleSettingsScriptHash();

  assert.match(hash, /^[0-9a-f]{56}$/);
});

test("decodes sh_settings CBOR into named YAML fields", () => {
  const decoded = decodeShSettingsDatum(previewDatum);

  assert.equal(decoded.virtual_price, 2000000);
  assert.deepEqual(decoded.buy_down_prices[0], [1000000000, 10]);
  assert.equal(decoded.payment_address.startsWith("30195bde"), true);
});

test("rejects malformed sh_settings datum shapes", () => {
  assert.throws(
    () => decodeShSettingsDatum(datumHex(validDatumFields().slice(0, 7))),
    /sh_settings datum must contain 8 fields, received 7/
  );

  assert.throws(
    () => decodeShSettingsDatum(Buffer.from(new helios.IntData(1n).toCbor()).toString("hex")),
    /not a list/
  );

  const nonByteArrayContract = validDatumFields();
  nonByteArrayContract[0] = new helios.ListData([intData(1)]);
  assert.throws(
    () => decodeShSettingsDatum(datumHex(nonByteArrayContract)),
    /valid_contracts item must decode to a byte array/
  );

  const nonIntVirtualPrice = validDatumFields();
  nonIntVirtualPrice[2] = byteArray("01");
  assert.throws(
    () => decodeShSettingsDatum(datumHex(nonIntVirtualPrice)),
    /virtual_price must decode to an int/
  );

  const shortBuyDownPair = validDatumFields();
  shortBuyDownPair[4] = new helios.ListData([new helios.ListData([intData(3)])]);
  assert.throws(
    () => decodeShSettingsDatum(datumHex(shortBuyDownPair)),
    /buy_down_prices\[0\] must contain exactly two ints/
  );
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

test("discoverNextContractSubhandle delegates to the canonical Python helper", async () => {
  // The discovery logic itself is owned by adahandle-deployments/common/discover_subhandles.py
  // and tested at common/discover_subhandles_test.py. Here we only verify
  // that the JS wrapper invokes the right script and returns its stdout.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-stub-"));
  const stubPath = path.join(tmpDir, "discover_subhandles.py");
  fs.writeFileSync(
    stubPath,
    "#!/usr/bin/env python3\n" +
      "import sys\n" +
      "for i, a in enumerate(sys.argv):\n" +
      "  if a == '--slug': slug = sys.argv[i+1]\n" +
      "print(f'{slug}1@handlecontract')\n",
    { mode: 0o755 }
  );
  const origPath = process.env.DISCOVER_SUBHANDLES_PATH;
  process.env.DISCOVER_SUBHANDLES_PATH = stubPath;
  try {
    const subhandle = await discoverNextContractSubhandle({
      network: "preview",
      deploymentHandleSlug: "subh",
      namespace: "handlecontract",
      currentSubhandle: null,
      userAgent: "codex-test",
    });
    assert.equal(subhandle, "subh1@handlecontract");
  } finally {
    restoreEnv("DISCOVER_SUBHANDLES_PATH", origPath);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("surfaces empty SubHandle discovery helper output", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-empty-stub-"));
  const stubPath = path.join(tmpDir, "discover_subhandles.py");
  fs.writeFileSync(stubPath, "#!/usr/bin/env python3\n", { mode: 0o755 });
  const origPath = process.env.DISCOVER_SUBHANDLES_PATH;
  process.env.DISCOVER_SUBHANDLES_PATH = stubPath;
  try {
    await assert.rejects(
      discoverNextContractSubhandle({
        network: "preview",
        deploymentHandleSlug: "subh",
        namespace: "handlecontract",
        currentSubhandle: null,
        userAgent: "codex-test",
      }),
      /discover_subhandles.py returned empty stdout for subh@handlecontract/
    );
  } finally {
    restoreEnv("DISCOVER_SUBHANDLES_PATH", origPath);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("builds raw CBOR bytes and a matching hex artifact for the unsigned deployment tx", async () => {
  const tx = {
    witnessCount: 0,
    witnesses: {
      addDummySignatures(count) {
        tx.witnessCount += count;
      },
      removeDummySignatures(count) {
        tx.witnessCount -= count;
      },
    },
    toCbor() {
      return tx.witnessCount === 1 ? [0x84, 0x01, 0x02, 0x03] : [0x84, 0x01, 0x02];
    },
  };

  const artifact = await buildSubhandleSettingsDeploymentTxArtifact({
    desired: desiredState,
    handleName: "subh7@handlecontract",
    changeAddress: "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej",
    cborUtxos: ["abcd"],
    buildTxFn: async () => tx,
    fetchNetworkParametersFn: async () => ({ maxTxSize: 10 }),
  });

  assert.deepEqual([...artifact.cborBytes], [0x84, 0x01, 0x02]);
  assert.equal(artifact.cborHex, "840102");
  assert.equal(artifact.estimatedSignedTxSize, 4);
  assert.equal(artifact.maxTxSize, 10);
});

test("rejects unsigned deployment tx artifacts that would exceed max tx size after signing", async () => {
  const tx = {
    witnessCount: 0,
    witnesses: {
      addDummySignatures(count) {
        tx.witnessCount += count;
      },
      removeDummySignatures(count) {
        tx.witnessCount -= count;
      },
    },
    toCbor() {
      return tx.witnessCount === 1 ? new Array(301).fill(0x80) : new Array(200).fill(0x80);
    },
  };

  await assert.rejects(
    buildSubhandleSettingsDeploymentTxArtifact({
      desired: desiredState,
      handleName: "subh7@handlecontract",
      changeAddress: "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej",
      cborUtxos: ["abcd"],
      buildTxFn: async () => tx,
      fetchNetworkParametersFn: async () => ({ maxTxSize: 300 }),
    }),
    /too large after adding 1 required signature/i
  );
});

test("renders transaction order markdown from generated artifacts", () => {
  assert.deepEqual(renderTransactionOrderMarkdown(["tx-01.cbor", "tx-02.cbor"]), [
    "- `tx-01.cbor`",
    "- `tx-02.cbor`",
  ]);
  assert.deepEqual(renderTransactionOrderMarkdown([]), [
    "- Planner can emit `tx-XX.cbor` artifacts when `--change-address` and `--cbor-utxos-json` are supplied.",
  ]);
});
