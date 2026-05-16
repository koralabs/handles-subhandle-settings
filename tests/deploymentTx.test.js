import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import * as helios from "@koralabs/helios";

import {
  buildReferenceScriptDeploymentTx,
  fetchNetworkParameters,
} from "../deploymentTx.js";

const BASE_ADDRESS = "addr_test1qpzxs06vn7qagrqsm7wtquul8s5drxzk82wwr9qx3886m8lv7yv3mukuwdkne3v3va8dgd3xjkzqv90pu9gsc8hrl2xs9yqkej";
const HANDLE_POLICY_ID = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const HANDLE_PREFIX_222 = "000de140";

const baseAddress = () => helios.Address.fromBech32(BASE_ADDRESS);

const buildHandleValue = (handleName) =>
  new helios.Value(
    1n,
    new helios.Assets([
      [
        HANDLE_POLICY_ID,
        [[`${HANDLE_PREFIX_222}${Buffer.from(handleName, "utf8").toString("hex")}`, 1n]],
      ],
    ])
  );

const buildUtxoCbor = ({ index, value }) =>
  new helios.TxInput(
    new helios.TxOutputId(`${String(index).padStart(64, "0")}#0`),
    new helios.TxOutput(baseAddress(), value)
  ).toFullCbor();

test("fetchNetworkParameters loads the requested Helios network config", async () => {
  // Feature: deployment transaction generation loads protocol parameters for the selected network.
  // Failure mode: the deployer would fetch the wrong network-status endpoint before building an unsigned tx.
  const requestedUrls = [];
  let jsonRead = false;

  const params = await fetchNetworkParameters("preprod", async (url) => {
    requestedUrls.push(String(url));
    return {
      json: async () => {
        jsonRead = true;
        return {};
      },
    };
  });

  assert.deepEqual(requestedUrls, ["https://network-status.helios-lang.io/preprod/config"]);
  assert.equal(jsonRead, true);
  assert.equal(params.constructor.name, "NetworkParams");
});

test("deployment tx generation rejects script addresses as change addresses", async () => {
  // Feature: unsigned deployment artifacts must be created from a base wallet address that can sign the tx.
  // Failure mode: a script address would reach tx construction and produce an unsigned artifact nobody can submit.
  const scriptAddress = helios.Address.fromHash(new helios.ValidatorHash(new Array(28).fill(0))).toBech32();

  await assert.rejects(
    buildReferenceScriptDeploymentTx({
      network: "preview",
      handleName: "subh1@handlecontract",
      changeAddress: scriptAddress,
      cborUtxos: [],
      compileProgramFn: () => {
        throw new Error("compile should not run before change-address validation");
      },
      fetchNetworkParametersFn: async () => ({}),
    }),
    /Must be Base wallet to deploy/
  );
});

test("deployment tx generation rejects wallets missing the deployment handle input", async () => {
  // Feature: the unsigned reference-script tx must spend the wallet UTxO that carries the target deployment handle.
  // Failure mode: tx construction would continue with only spare ADA inputs and fail later with an unrelated error.
  await assert.rejects(
    buildReferenceScriptDeploymentTx({
      network: "preview",
      handleName: "subh1@handlecontract",
      changeAddress: BASE_ADDRESS,
      cborUtxos: [buildUtxoCbor({ index: 0, value: new helios.Value(10000000n) })],
      compileProgramFn: () => {
        throw new Error("compile should not run without the handle input");
      },
      fetchNetworkParametersFn: async () => ({}),
    }),
    /You don't have \$subh1@handlecontract handle/
  );
});

test("deployment tx generation finalizes with the handle input selected and spare inputs preserved", async (t) => {
  // Feature: tx generation spends the deployment-handle UTxO and leaves unrelated wallet UTxOs available for fees/change.
  // Failure mode: the builder could consume the wrong input or drop spare UTxOs before Helios finalization.
  const originalFinalize = helios.Tx.prototype.finalize;
  const originalCorrectLovelace = helios.TxOutput.prototype.correctLovelace;
  const networkParams = { maxTxSize: 16384 };
  const finalizedTx = { finalized: true };
  let correctedWith = null;
  let finalizedWith = null;
  let compiled = false;

  helios.TxOutput.prototype.correctLovelace = function correctLovelace(params) {
    correctedWith = params;
  };
  helios.Tx.prototype.finalize = async function finalize(params, changeAddress, spareUtxos) {
    finalizedWith = { params, changeAddress, spareUtxos };
    return finalizedTx;
  };
  t.after(() => {
    helios.Tx.prototype.finalize = originalFinalize;
    helios.TxOutput.prototype.correctLovelace = originalCorrectLovelace;
  });

  const result = await buildReferenceScriptDeploymentTx({
    network: "preview",
    handleName: "subh1@handlecontract",
    changeAddress: BASE_ADDRESS,
    cborUtxos: [
      buildUtxoCbor({ index: 0, value: new helios.Value(10000000n) }),
      buildUtxoCbor({ index: 1, value: buildHandleValue("subh1@handlecontract") }),
    ],
    compileProgramFn: () => {
      compiled = true;
      return null;
    },
    fetchNetworkParametersFn: async (network) => {
      assert.equal(network, "preview");
      return networkParams;
    },
  });

  assert.equal(result, finalizedTx);
  assert.equal(compiled, true);
  assert.equal(correctedWith, networkParams);
  assert.equal(finalizedWith.params, networkParams);
  assert.equal(finalizedWith.changeAddress.toBech32(), BASE_ADDRESS);
  assert.equal(finalizedWith.spareUtxos.length, 1);
  assert.equal(String(finalizedWith.spareUtxos[0].value.lovelace), "10000000");
});
