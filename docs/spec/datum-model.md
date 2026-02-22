# Datum Model

## Token Pairing
- Root handle asset:
  - CIP-68 label `222`.
- Subhandle settings token:
  - CIP-67 label `001`.

The settings token is paired with the root handle and stores minting configuration consumed by subhandle flows.

## Settings Scope
- Fee/price-related values.
- Allow/deny and gating configuration used by validator paths.
- Ownership and root-handle linkage constraints.

## Utility Encoding Notes
- Subhandle values are normalized to lowercase and trimmed.
- Asset names are UTF-8 hex encoded after normalization.
- Reference asset names are prefixed with the 100-label constant from shared enums.
