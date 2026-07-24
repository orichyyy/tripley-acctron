# Target 55: Taiwan BSP ATM v2.43 Session Profile

## Objective

Implement application-owned OEX session establishment and host-control routing from the BSP v2.43
specification.

## Phases

1. **Specification extraction and protocol correction** - complete
2. **Fixed-field profile and OEX establishment** - complete
3. **Frame router and host-control registry** - complete
4. **Golden vectors and extension tests** - complete
5. **Validation, review, and commit** - complete

## Required behavior

- Profile source is compiled application TypeScript.
- OEX B001, not AEX, establishes ATM service readiness.
- SNS is host-initiated and has no invented reply.
- RBT and other high-risk controls require explicit project contributions.
- Safe summaries contain no raw body or exception text.

## Errors

| Error | Attempts | Resolution |
|---|---:|---|
| Initial typecheck rejected an explicit undefined optional callback and widened mock literals | 1 | Conditionally spread the callback and preserve sent as a literal result. |
| Golden test placed the country field three bytes late | 1 | Correct the independently asserted OEX country offset to bytes 126 through 128. |
| Biome requested import ordering and line wrapping | 1 | Apply repository-safe formatting to Target 55 files. |
| Full validation was initially started with a one-second shell timeout | 1 | Re-run with 120 seconds; workspace typecheck, tests, and builds passed. |
