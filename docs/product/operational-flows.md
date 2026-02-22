# Operational Flows

## Contract Validation Flow
1. Build fixture contexts for root handle and settings token states.
2. Execute validator scenarios from `tests/tests.ts`.
3. Validate approve/deny outcomes for subhandle settings behavior.

## Utility Validation Flow
1. Normalize subhandle input.
2. Encode normalized value as UTF-8 hex.
3. Prefix encoded value with CIP-67 reference-token label.
4. Validate fee and numeric settings inputs through utility checks.

## Coverage Flow
1. Run `node --test tests/subhandleUtils.test.js`.
2. Run `./test_coverage.sh`.
3. Confirm `test_coverage.report` records >=90% line and branch coverage.
