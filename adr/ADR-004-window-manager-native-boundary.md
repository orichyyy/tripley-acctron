# ADR-004 Window Manager Native Boundary

## Decision

Window Manager requires native SDK window/display APIs. No production `window.open` fallback.

## Consequences

- Window/display/z-order/placement are P0 SDK requirements.
- Multi-screen kiosk layout is deterministic.
- Unsupported window feature fails fast.
