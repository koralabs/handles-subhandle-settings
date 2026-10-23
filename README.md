# handles-subhandle-settings

## Contributor test policy

All tests are local-only by owner directive. Preserve local test scripts. GitHub Actions must not run tests directly or indirectly through lifecycle hooks, composites, shared helpers, or renamed commands. Build, lint, publish, deployment, and production dispatch guards remain allowed; obsolete test-only required checks must be removed without weakening unrelated protections.
CIP-67 (001) tokens paired with Handle (222) tokens (similar to CIP-68) that store SubHandle Minting settings for a root Handle

## Documentation
- [Docs Index](./docs/index.md)
- [Product Docs](./docs/product/index.md)
- [Spec Docs](./docs/spec/index.md)

## Local Validation
- `npm test` (scenario harness; requires stable upstream datum fixture responses)
- `node --test tests/subhandleUtils.test.js`
- `node --test tests/deploymentState.test.js tests/deploymentPlan.test.js`
- `node scripts/generateDeploymentPlan.js --desired deploy/preview/subhandle-settings.yaml --artifacts-dir /tmp/subhandle-settings-plan`
- `./test_coverage.sh`
