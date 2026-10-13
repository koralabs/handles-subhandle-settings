# handles-subhandle-settings canonical contract

**Status: proposal (ecosystem-ownership-plan row 5.2). Operator review pending.**

This contract guards each root handle's sub-handle settings (who may mint subs under it and at
what price). The code that holds the rules below is listed in [`.enclave`](./.enclave);
K.O.R.A.'s `merge_pr` asks the operator before a change to it merges into `master`.

## Source requirements

- Ecosystem `AGENTS.md` (koralabs root), "Critical Correctness": handle addresses correct 100% of
  the time, never double-mint, properties chain-accurate. "Merging": any edit to an on-chain
  contract/validator or to contract settings (settings handles, policy roots, `pers*@handle_settings`
  datums, handlecontract datums), anything that could double-mint, and any automated burn is
  higher-risk and needs operator approval before merge.
- kora-bot `v3/docs/ecosystem-ownership-plan.md` §6 decision 2: for contract repos the enclave holds
  validators, settings datums, policy roots and tx builders; K.O.R.A. may sign for preview only,
  preprod and mainnet always need humans on the multisig. Phase 5 row 5.2.
- kora-bot `v3/docs/tool-surface.md` (`merge_pr`): cards enclave paths merged into
  `master`/`main`/`mainnet`/`preprod`, reading a root `.enclave`.
- This repo: [`docs/spec/spec.md`](./docs/spec/spec.md),
  [`docs/spec/datum-model.md`](./docs/spec/datum-model.md),
  [`docs/spec/contract-deployment-pipeline.md`](./docs/spec/contract-deployment-pipeline.md).

## Must never be violated

1. **Only the root owner changes a root's sub-handle settings** (`UPDATE_SETTINGS`: the root's 222
   is spent and its owner signs). A `MIGRATE` needs an admin signer, plus the owner when
   `migrate_sig_required` is set. The settings output always returns to a valid contract.
2. **Sub-handle settings stay chain-accurate.** The datum shape in `datum-model.md` is what the
   minting engine and api read; a drift there mis-prices or mis-allows sub mints.
3. **Signing:** K.O.R.A. may sign preview deploys only; preprod and mainnet always need humans on
   the multisig.

## Where it is enforced today

| # | Code |
|---|---|
| 1 | `subh.helios` (`admin_has_signed_tx`, `is_valid_contract`) |
| 2 | `subhandleUtils.js`, `deploy/<network>/subhandle-settings.yaml` |
| 3 | `deploymentPlan.js`, `deploymentTx.js`, `.github/workflows/deployment-plan.yml` |

## Refactor needed for enforcement

- **One admin key is hard-coded in `subh.helios`** next to `admin_creds`; rotating it means a new
  script hash. It should live only in the admin settings datum.

- **The validator's tests depend on a live API** (`docs/spec/spec.md` "Known Test Runtime
  Constraint"), so a contract change can merge with its tests unrunnable. Fixtures should be local.
- **Rule 3 is prose only** (plan row 4.7).
