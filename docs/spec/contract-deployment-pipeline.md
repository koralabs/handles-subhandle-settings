# Contract Deployment Pipeline Spec

## Repository Scope
This repo owns the desired on-chain deployment state for subhandle settings contracts and related datum/settings values.

The repo should define what ought to be live on `preview`, `preprod`, and `mainnet`. It should not be treated as the storage location for volatile live references such as current settings UTxO refs.

Canonical slug naming for this repo follows the shared rule in `kora-bot/docs/spec/contract-deployment-pipeline.md`:
- `<app><[ord|mnt|ref|roy]><[mpt]>`
- `contract_slug`, `script_type`, and `deployment_handle_slug` must match
- `old_script_type` is legacy migration-only

## State Model
- Desired state lives in committed YAML files in this repo.
- Observed live state is read from chain UTxOs and deployed script hashes.
- Operational automation config lives outside this repo in orchestration/control-plane repos.
- Volatile fields such as `tx_hash`, `output_index`, and current UTxO refs belong in observed-state artifacts, not committed desired-state YAML.

## Desired State Files
The intended layout is:

```text
deploy/<network>/<contract_slug>.yaml
```

Each file should contain stable desired state only:

```yaml
schema_version: 2
network: preview
contract_slug: subh
script_type: subh
old_script_type: sub_handle_settings
deployment_handle_slug: subh
build:
  target: subh.helios
  kind: validator
subhandle_strategy:
  namespace: handlecontract
  format: contract_slug_ordinal
assigned_handles:
  settings:
    - sh_settings
  scripts:
    - subhsetcont_003
ignored_settings: []
settings:
  type: subhandle_settings
  values:
    sh_settings:
      # decoded comparable AdminSettings fields only
```

Required stable fields:
- `schema_version`
- `network`
- `contract_slug`
- `script_type`
- `deployment_handle_slug`
- `build.target`
- `build.kind`
- `subhandle_strategy.namespace`
- `subhandle_strategy.format`
- `assigned_handles.settings`
- `assigned_handles.scripts`
- `ignored_settings`
- `settings.type`
- `settings.values`

Observed-only fields that must not be committed into desired-state YAML:
- `current_script_hash`
- `current_settings_utxo_ref`
- `current_subhandle`
- `observed_at`
- `last_deployed_tx_hash`

Normalization rules for this repo:
- `sh_settings` is stored as decoded named `AdminSettings` fields, not raw CBOR.
- `deployment_handle_slug` must be 10 characters or fewer and must not contain separators.

## Drift Detection
Deployment automation should:
- build the contract and derive the expected script hash,
- load desired YAML from this repo,
- read live chain state for the contract settings UTxO,
- normalize the live `sh_settings` CBOR into the same YAML shape,
- classify drift as `script_hash_only`, `settings_only`, or `script_hash_and_settings`.

No deployment artifact should be created when desired and live state already match.

## SubHandle Rules
- A script hash change requires a new SubHandle in the format `<deployment_handle_slug><ordinal>@handlecontract`.
- A settings-only change reuses the current SubHandle and moves it forward with the settings UTxO.
- The next ordinal must be derived from live chain state, not a repo-local counter.

## Artifact Contract
The deployment workflow for this repo should emit:
- `deployment-plan.json`
- `summary.md`
- `summary.json`
- one or more `tx-XX.cbor` artifacts
- optional observed-state snapshot artifacts for debugging and audit

Current rollout behavior:
- push and pull request runs emit `deployment-plan.json`, `summary.json`, and `summary.md` for every committed `deploy/<network>/subhandle-settings.yaml`
- manual dispatch may target one desired-state YAML via `desired_path`
- no unsigned CBOR artifact is emitted yet for this repo; the workflow is currently informational-only until a repo-native tx builder is added
- if the live script hash differs, the summary may mark the deployment handle step as manual review because the repo is still published behind legacy names such as `subhsetcont_003` and `sub_settings_01` rather than a fully auto-allocatable `*.handlecontract` sequence

The canonical observed-state artifact should be JSON and should include:

```json
{
  "schema_version": 1,
  "repo": "handles-subhandle-settings",
  "network": "preview",
  "contract_slug": "subh",
  "current_script_hash": "<hash>",
  "current_settings_utxo_ref": "<tx>#<ix>",
  "current_subhandle": "subh1@handlecontract",
  "settings": {
    "type": "subhandle_settings",
    "values": {
      "sh_settings": {}
    }
  },
  "observed_at": "<iso8601>"
}
```

If more than one transaction is required, the plan artifact must encode execution order and dependencies.

## Human Approval Boundary
Automation prepares deployment transactions and summaries.

Humans remain responsible for:
- downloading CBOR artifacts,
- uploading/signing/submitting in Eternl,
- approving the deployment at the wallet boundary.

Post-submit automation should verify that chain state converges to the desired YAML plus the expected SubHandle transition.
