# Technical Spec

## Architecture

### Core Assets
- Validator source: `subhandle_settings.helios`
- Test harness:
  - `tests/tests.ts`
  - `tests/sub_handle_settings_fixtures.ts`
- Utility helpers:
  - `subhandleUtils.js`
  - `tests/subhandleUtils.test.js`

### Utility Contracts
- `normalizeSubhandle(value)`
  - trims and lowercases subhandle strings.
- `toHexUtf8(value)`
  - encodes normalized subhandle to hex.
- `buildReferenceAssetName(subhandle)`
  - prefixes with reference label (`LBL_100`).
- `isNonNegativeInt(value)`
  - validates non-negative integer values for settings inputs.

## Testing and Coverage
- Repository legacy contract test command:
  - `npm test` (currently depends on external API responses in fixture conversion path).
- Coverage guardrail command:
  - `./test_coverage.sh`
- Coverage artifact:
  - `test_coverage.report`

## Known Test Runtime Constraint
- Current `npm test` path can fail when upstream datum conversion endpoint returns unavailable responses during fixture initialization.
