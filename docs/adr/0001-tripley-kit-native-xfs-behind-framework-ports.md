# Use Tripley Kit native and XFS clients behind framework ports

Status: accepted

The kiosk framework will integrate `@tripley-kit/native` for host native capabilities and `@tripley-kit/xfs-client` for optional CEN/XFS devices, but application, Flow, Command, Condition, and UI packages must depend on framework ports instead of raw Tripley Kit clients. `@tripley-kit/xfs-control-client` is reserved for simulator automation tests. This keeps XFS as a replaceable provider plugin, preserves the existing device abstraction boundary, and prevents native/XFS transport concerns from leaking into kiosk application code.

## Considered Options

- Import `@tripley-kit/xfs-client` directly in Flow nodes and commands. Rejected because it duplicates lifecycle, cancellation, locking, logging, and secure input rules in application code.
- Add XFS methods to the Native SDK requirements. Rejected because native host capabilities and CEN/XFS device capabilities have different lifecycle, security, simulator, and extension models.
- Build framework device services over `DeviceRegistry`, `InputSourceRegistry`, and health contributions. Accepted because it matches the open device model and lets project device plugins extend the kiosk without modifying core.

## Consequences

- A bridge package must own connection creation, logical service mapping, XFS session management, device ports, health checks, and input source adapter registration.
- `@tripley-kit/xfs-client` must expose a stable public facade for every XFS module the framework wraps; relying on generated internal paths is not acceptable.
- Simulator control is only a test dependency and must not be bundled into production kiosk applications.
