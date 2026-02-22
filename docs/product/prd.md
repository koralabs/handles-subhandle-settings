# Handles Subhandle Settings PRD

## Summary
`handles-subhandle-settings` maintains validator logic and tests for subhandle-settings reference tokens (CIP-67 label `001`) paired with root handle assets (label `222`).

## Problem
Root handle owners need a chain-native settings datum that controls subhandle minting behavior while preserving ownership and policy integrity.

## Users
- Contract engineers maintaining subhandle settings rules.
- Operators validating and deploying subhandle-settings contract updates.
- Integrators consuming encoded settings outputs for subhandle minting flows.

## Goals
- Keep subhandle-settings token/data behavior deterministic.
- Validate core contract scenarios in local test harnesses.
- Maintain repository-level coverage guardrail artifacts.

## Non-Goals
- Subhandle marketplace UX.
- Off-chain API orchestration and wallet frontends.
- Generic profile personalization logic (handled in other repos).

## Functional Requirements
- Support root-handle-linked settings token model (001 + 222 pairing).
- Validate settings update/minting constraints through contract tests.
- Provide simple local utility layer for subhandle asset-name handling.
- Provide `test_coverage.sh` and `test_coverage.report` for >=90% line/branch coverage.

## Success Criteria
- Utility coverage guardrail passes with >=90% lines/branches.
- Contract/docs links remain available in README and docs index.
