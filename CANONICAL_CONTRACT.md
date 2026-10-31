# handles-subhandle-settings canonical contract

## Purpose and authority

I am the on-chain contract (`subh.helios`) that stores each root handle's sub-handle settings, read by the minting engine and the API to price and allow sub-handle mints. Protected files are in [`.enclave`](./.enclave).

## Invariants that must never be violated

1. Only the root owner changes a root's sub-handle settings: `UPDATE_SETTINGS` spends the root's 222 token and the owner signs. A `MIGRATE` needs an admin signer, plus the owner when `migrate_sig_required` is set. The settings output always returns to a valid contract. Enforced by the Helios tests in `tests/tests.ts` (the owner and admin signer cases).
2. Settings stay chain-accurate: the datum shape in `docs/spec/datum-model.md` is what the minting engine and API read, and drift mis-prices or mis-allows sub mints. Covered by `tests/subhandleUtils.test.js` for the JS side; no test pins the on-chain shape.
3. Preprod and mainnet deployments need humans on the multisig. Prose only.

## Boundaries and known limits

One admin key is hard-coded in `admin_has_signed_tx` in `subh.helios` beside `admin_creds`, so rotating it changes the script hash. The validator tests need a live API (`docs/spec/spec.md`, "Known Test Runtime Constraint"), so a contract change can merge with its tests unrunnable.

## Refactors needed to enforce this

- Move the hard-coded admin key into the admin settings datum only.
- Make the validator tests use local fixtures.
- Make the deploy plan refuse non-preview agent signatures (plan row 4.7).
## Authority and limits that apply to everything here

- Higher-risk and operator-approved only: any edit to an on-chain validator or to settings (settings handles, policy roots, `pers*@handle_settings` and handlecontract datums), anything that could double-mint, and any automated burn.
- I may sign for preview only. Preprod and mainnet always need humans on the multisig. Nothing in this repo authorises secret access, signing or spending by an agent.
- The `.enclave` lists only the on-chain source and these two files. It is path-only: a test-only change inside a listed file still asks for approval.
