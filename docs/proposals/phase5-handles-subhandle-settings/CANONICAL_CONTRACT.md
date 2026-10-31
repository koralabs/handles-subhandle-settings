# handles-subhandle-settings canonical contract

**Status: DRAFT proposal (ecosystem-ownership-plan Phase 5, row 5.2). NOT ACTIVE.** Re-drafted 2026-10-28 from the closed proposal #12. It lives under `docs/proposals/phase5-handles-subhandle-settings/`, where `merge_pr` does not read it. The operator adopts it by moving this file and `.enclave` to the repo root in a separate change; paths below are repo-root-relative. Operator review of what must never be violated is pending.

This contract guards each root handle's sub-handle settings (who may mint subs under it and at
what price). Protected production source is listed in [`.enclave`](./.enclave);
other enforcement references below are not automatically enclave paths.

## Review scope and unchanged authority

Decision 2 clarification (2026-10-13): the human-review enclave is actual Aiken/Helios
on-chain source, listed as exact files in [`.enclave`](./.enclave), plus this contract
and the manifest's self-protection. Test-only sources, npm/package files, JS/TS,
builders, configuration, generated artifacts and workflows follow ordinary automated
tests and independent agent review; their location in a contract repository alone
never requires human approval. Existing unrelated holds remain in force.

Separately identifiable embedded Aiken `test` blocks and test-only helpers are testing
code, not protected on-chain behavior. Test-only edits to those blocks follow ordinary
agent review. Mixed files remain listed for their production definitions: the current
path-only merge gate cannot distinguish such hunks and may still request approval.
This is an enforcement limitation, not expanded human-review policy; no source was
split or changed in this documentation-only proposal.

This narrows code-review scope only. Actual on-chain validator or settings changes
(settings handles, policy roots, `pers*@handle_settings` and handlecontract datums),
anything that could double-mint, and automated burns or other irreversible on-chain
actions retain explicit operator authorization. Routine builder/package/test repairs
are not such actions merely because of their repository or filename. K.O.R.A. may
sign for preview only within existing authorization; preprod and mainnet always need
humans on the multisig. No signing, secret access or spending is authorized here.
Independent review pending; this proposal is not accepted and must not be merged.

## Source requirements

- Ecosystem `AGENTS.md` (koralabs root), "Critical Correctness": handle addresses correct 100% of
  the time, never double-mint, properties chain-accurate. "Merging": any edit to an on-chain
  contract/validator or to contract settings (settings handles, policy roots, `pers*@handle_settings`
  datums, handlecontract datums), anything that could double-mint, and any automated burn is
  higher-risk and needs operator approval before merge.
- kora-bot `v3/docs/ecosystem-ownership-plan.md` §6 decision 2: for contract repos the enclave holds
  Aiken/Helios on-chain source, excluding testing and npm/package code; K.O.R.A. may sign for preview only,
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
