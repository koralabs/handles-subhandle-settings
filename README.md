# handles-subhandle-settings
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
