import fs from "node:fs/promises";
import path from "node:path";

import {
  buildSubhandleSettingsDeploymentTxArtifact,
  buildExpectedSubhandleSettingsScriptHash,
  buildSubhandleSettingsDeploymentPlan,
  discoverNextContractSubhandle,
  fetchLiveSubhandleSettingsDeploymentState,
  renderTransactionOrderMarkdown,
} from "../deploymentPlan.js";
import { loadDesiredDeploymentState } from "../deploymentState.js";

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    args[token.slice(2)] = next;
    index += 1;
  }
  return args;
};

const renderSummaryMarkdown = (summaryMarkdown, transactionOrder) => {
  const lines = summaryMarkdown.split("\n");
  const transactionOrderIndex = lines.lastIndexOf("## Transaction Order");
  if (transactionOrderIndex < 0) {
    return summaryMarkdown;
  }
  return [
    ...lines.slice(0, transactionOrderIndex + 1),
    ...renderTransactionOrderMarkdown(transactionOrder),
    ...lines.slice(transactionOrderIndex + 2),
  ].join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const changeAddress = args["change-address"] ?? "";
  const cborUtxosJson = args["cbor-utxos-json"] ?? "";
  if (!args.desired || !args["artifacts-dir"]) {
    throw new Error("usage: --desired <path> --artifacts-dir <dir> [--change-address <addr> --cbor-utxos-json <json>]");
  }
  if (Boolean(changeAddress) !== Boolean(cborUtxosJson)) {
    throw new Error("--change-address and --cbor-utxos-json must be provided together");
  }

  const desired = await loadDesiredDeploymentState(args.desired);
  const userAgent = (process.env.KORA_USER_AGENT || "kora-contract-deployments/1.0").trim();
  const expectedScriptHash = buildExpectedSubhandleSettingsScriptHash();
  const live = await fetchLiveSubhandleSettingsDeploymentState({
    network: desired.network,
    scriptType: desired.oldScriptType ?? desired.scriptType,
    userAgent,
  });
  const plan = buildSubhandleSettingsDeploymentPlan({
    desired,
    expectedScriptHash,
    live,
    nextSubhandle: live.currentScriptHash === expectedScriptHash
      ? null
      : await discoverNextContractSubhandle({
          network: desired.network,
          deploymentHandleSlug: desired.deploymentHandleSlug,
          namespace: desired.subhandleStrategy.namespace,
          currentSubhandle: live.currentSubhandle,
          userAgent,
        }),
  });

  await fs.mkdir(args["artifacts-dir"], { recursive: true });
  const generatedArtifacts = ["summary.json", "summary.md", "deployment-plan.json"];
  let transactionOrder = [];
  let txArtifactGenerated = false;
  const writePlanFiles = async () => {
    for (const [name, payload] of Object.entries({
      "summary.json": JSON.stringify({
        ...plan.summaryJson,
        transaction_order: transactionOrder,
        tx_artifact_generated: txArtifactGenerated,
        artifact_files: generatedArtifacts,
      }, null, 2),
      "summary.md": renderSummaryMarkdown(plan.summaryMarkdown, transactionOrder),
      "deployment-plan.json": JSON.stringify({
        ...plan.deploymentPlanJson,
        transaction_order: transactionOrder,
        tx_artifact_generated: txArtifactGenerated,
        artifact_files: generatedArtifacts,
      }, null, 2),
    })) {
      await fs.writeFile(path.join(args["artifacts-dir"], name), `${payload}\n`);
    }
  };
  await writePlanFiles();

  if (
    changeAddress &&
    cborUtxosJson &&
    plan.driftType === "script_hash_only" &&
    plan.summaryJson.contracts[0].subhandle.action === "allocate"
  ) {
    const handleName = String(plan.summaryJson.contracts[0].subhandle.value ?? "").trim();
    if (!handleName) {
      throw new Error("missing deployment handle for subhandle-settings tx artifact generation");
    }
    const txArtifact = await buildSubhandleSettingsDeploymentTxArtifact({
      desired,
      handleName,
      changeAddress,
      cborUtxos: JSON.parse(cborUtxosJson),
    });
    const fileName = "tx-01.cbor";
    await fs.writeFile(path.join(args["artifacts-dir"], fileName), txArtifact.cborBytes);
    await fs.writeFile(path.join(args["artifacts-dir"], `${fileName}.hex`), `${txArtifact.cborHex}\n`);
    generatedArtifacts.push(fileName, `${fileName}.hex`);
    transactionOrder = [fileName];
    txArtifactGenerated = true;
    await writePlanFiles();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
