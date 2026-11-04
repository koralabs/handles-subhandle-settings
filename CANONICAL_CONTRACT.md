# handles-subhandle-settings canonical contract

I am the on-chain contract (`subh.helios`) that stores each root handle's sub-handle settings, read by the minting engine and the API to price and allow sub-handle mints.

1. **Only the root owner changes a root's sub-handle settings.** `UPDATE_SETTINGS` spends the root's 222 token and the owner signs; the settings output always returns to a valid contract.
2. **Migration needs an admin.** `MIGRATE` requires an admin signer, plus the owner when `migrate_sig_required` is set.
3. **Settings stay chain-accurate.** The datum shape in `docs/spec/datum-model.md` is what the minting engine and API read; drift mis-prices or mis-allows sub-handle mints.
4. **One admin key is hard-coded** in `admin_has_signed_tx` beside `admin_creds`, so rotating it changes the script hash.
