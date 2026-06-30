# ADR-005 Plugin Contract

## Decision

Plugins declare manifest, dependencies, permissions, compatibility, and contributions. Lifecycle is install/register/activate/deactivate/dispose. Activate failure fails app startup unless project marks plugin optional.

## Consequences

- Plugin dependencies are explicit.
- Kiosk base is runtime preset + plugin bundle + template.
- v1 permissions are warning/trace, not enforcement.
