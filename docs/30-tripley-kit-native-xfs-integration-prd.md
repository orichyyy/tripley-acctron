# PRD: Tripley Kit Native and XFS Kiosk Integration

## Problem Statement

Kiosk application developers need this framework to run against real native capabilities and simulator-backed CEN/XFS devices from a browser, automated script, or desktop container. The framework already defines Flow, Command, UI, Device, InputSource, kiosk base, native adapter, storage, TTS, and testing abstractions, but it does not yet integrate the controlled Tripley Kit native and XFS libraries into a production-shaped kiosk development stack.

The available dependencies create a clear path: `@tripley-kit/native` satisfies the Native SDK requirements, `@tripley-kit/xfs-client` can operate simulator or hardware-backed logical services through `tripley-native-hostd`, and `@tripley-kit/xfs-control-client` can automate simulator state in tests. The missing work is the framework integration layer that hides those raw clients behind framework-owned ports, device services, input source adapters, health checks, and kiosk presets.

Without this integration, project teams must either hard-code raw XFS calls in Flow or Command code, duplicate lifecycle/cancellation/security behavior in every project, or manually test simulator behavior. That would violate the Device Abstraction Layer, weaken secure input safety, and make kiosk applications difficult to maintain.

## Solution

Build a Tripley Kit integration layer that makes this framework usable as a kiosk application development platform.

The solution adds a Native connection adapter package for `@tripley-kit/native`, an XFS Device Service package for `@tripley-kit/xfs-client`, a simulator automation test harness for `@tripley-kit/xfs-control-client`, and a hostd-backed mode in the kiosk example. Application code continues to use Flow, Command, Condition, UI, Device, InputSource, Health, Audit, and kiosk base abstractions. Raw Tripley Kit clients remain isolated at the integration edge.

The first production-shaped milestone should cover IDC, PIN, and BCR because those prove card events, dynamic user input, optional QR input, secure PIN input, timeout/interrupt behavior, session cancellation, health checks, and simulator automation. CDM dispense should follow after the first input/auth vertical slice is stable.

## User Stories

1. As a kiosk application developer, I want to connect the framework to `tripley-native-hostd`, so that I can test native capabilities from a browser.
2. As a kiosk application developer, I want to use `@tripley-kit/native` through the framework `NativePort`, so that my application code does not depend on native SDK details.
3. As a kiosk application developer, I want native capability checks to fail before kiosk boot, so that missing window, display, SQLite, TTS, or secure storage support is detected early.
4. As a kiosk application developer, I want WebSocket hostd connection options in configuration, so that browser and script tests can point at the right local host.
5. As a kiosk application developer, I want Tauri and Electron native connection paths to remain possible, so that the same framework can run outside browser-hostd development mode.
6. As a kiosk application developer, I want XFS logical services mapped to framework device ids, so that flows can reference stable device concepts instead of simulator service names.
7. As a kiosk application developer, I want IDC card reader behavior exposed through a framework Device Port, so that card operations follow framework lifecycle and logging rules.
8. As a kiosk application developer, I want PIN pad data entry exposed through a framework Device Port, so that amount and account input can use the standard UserInput node.
9. As a kiosk application developer, I want secure PIN entry exposed through a framework Device Port, so that encrypted PIN results are handled without exposing raw PIN digits.
10. As a kiosk application developer, I want barcode QR scanning exposed through a framework Device Port, so that QR input can race with other input sources.
11. As a kiosk application developer, I want CDM cash dispenser support planned as a second phase, so that cash-specific state does not block input/auth integration.
12. As a flow author, I want `pinpad.data` to be registered as an Input Source Adapter, so that dynamic `userInput` amount entry works without executor changes.
13. As a flow author, I want `pinpad.pin` to be registered as an Input Source Adapter, so that secure PIN input works through registry lookup only.
14. As a flow author, I want `barcodeReader.qr` to be registered as an Input Source Adapter, so that optional QR input can be enabled by configuration.
15. As a flow author, I want card reader input to be available as an open input source kind, so that card-first flows can be modeled declaratively.
16. As a flow author, I want XFS input sessions to implement cancellation, so that timeout, interrupt, and node exit clean up active device operations.
17. As a flow author, I want optional QR input to be cancelled when another source wins, so that no stale BCR command remains active.
18. As a flow author, I want local validation failure to stay on the same input node, so that UI feedback and retry behavior remain consistent with existing UserInput semantics.
19. As a flow author, I want business validation to reenter the input node, so that host or project validation failures can reuse the same input UI safely.
20. As a flow author, I want secure PIN input to return only encrypted or tokenized results, so that the framework never handles raw PIN text.
21. As a command author, I want command handlers to use framework device and transaction services instead of raw XFS clients, so that idempotency and audit behavior stay consistent.
22. As a command author, I want command middleware to work with simulator-backed flows, so that loading, disable-while-running, debounce, throttle, TTS, and idempotency rules remain effective.
23. As a UI developer, I want the kiosk example to show hostd-backed mode, so that I can see how a real kiosk application is wired.
24. As a UI developer, I want the kiosk example to keep in-memory mode, so that CI and local development can run without simulator dependencies.
25. As a UI developer, I want validation failures to update UI feedback state, so that customer-facing prompts can show actionable errors.
26. As a UI developer, I want secure PIN screens to avoid raw PIN state, so that UI state cannot leak sensitive input.
27. As a project integrator, I want project-specific device plugins to register devices and input sources without modifying core, so that bank-specific peripherals are supported cleanly.
28. As a project integrator, I want feature flags to enable or disable QR input, so that deployments can vary device availability by site.
29. As a project integrator, I want logical service names in project configuration, so that simulator and hardware environments can use different service names.
30. As a project integrator, I want health checks for every configured XFS logical service, so that availability and readiness are visible before starting a flow.
31. As an operations engineer, I want device status changes mapped to framework event topics, so that monitoring and interrupt policies use stable event names.
32. As an operations engineer, I want card removal to map to the existing flow interrupt policy, so that customer removal cancels active flows safely.
33. As an operations engineer, I want XFS completion codes normalized into framework-safe results, so that business logic is not coupled to raw provider details.
34. As an operations engineer, I want raw XFS diagnostic metadata redacted, so that logs remain useful without exposing restricted data.
35. As a QA engineer, I want simulator state controlled through `@tripley-kit/xfs-control-client`, so that integration tests are deterministic.
36. As a QA engineer, I want tests to insert and remove cards programmatically, so that card interrupt scenarios can be automated.
37. As a QA engineer, I want tests to press PIN keys programmatically, so that secure PIN flow can be verified without manual input.
38. As a QA engineer, I want tests to complete BCR reads programmatically, so that optional QR racing behavior can be verified.
39. As a QA engineer, I want tests to configure cash unit state later, so that CDM dispense tests can be added after input/auth is stable.
40. As a QA engineer, I want hostd-backed browser smoke tests, so that the application path matches real deployment transport behavior.
41. As a QA engineer, I want simulator tests separated from unit tests, so that CI can run fast tests without requiring Windows XFS simulator.
42. As a framework maintainer, I want XFS integration isolated in one package, so that core packages stay platform-neutral.
43. As a framework maintainer, I want no direct React Router or UI dependency in the XFS service, so that device behavior remains independent from presentation.
44. As a framework maintainer, I want no direct XFS dependency in Flow Engine, so that UserInput stays open to any device plugin.
45. As a framework maintainer, I want no direct XFS dependency in Command System, so that commands stay testable with fake services.
46. As a framework maintainer, I want no production dependency on simulator control, so that kiosk builds cannot accidentally ship simulator APIs.
47. As a framework maintainer, I want `@tripley-kit/xfs-client` to expose all supported module clients publicly, so that framework code does not import unstable generated internals.
48. As a framework maintainer, I want clear module resolution failures, so that missing XFS providers are diagnosed quickly.
49. As a framework maintainer, I want device locks integrated with XFS sessions, so that concurrent flows cannot operate the same device unsafely.
50. As a framework maintainer, I want startup and cleanup lifecycle owned by the XFS Device Service, so that applications do not duplicate manager calls.
51. As a security reviewer, I want PIN block format, key slot, and KSN handling documented as configuration, so that cryptographic behavior is auditable.
52. As a security reviewer, I want secure input logging to use safe summaries only, so that raw PIN values never enter traces.
53. As a security reviewer, I want QR and card data classified as sensitive, so that logging and UI handling can redact appropriately.
54. As a security reviewer, I want raw XFS control plane access excluded from production presets, so that simulator-only controls cannot be abused.
55. As a product owner, I want the kiosk example to demonstrate withdrawal-like behavior with real device integration, so that project teams have a usable starting point.
56. As a product owner, I want extension examples to remain project-owned, so that future bank integrations do not require core framework changes.

## Implementation Decisions

- The integration follows the ADR decision that Tripley Kit native and XFS clients must live behind framework ports.
- The Native SDK integration will be implemented as a framework adapter package that creates `TripleyNative` through WebSocket, Tauri, or Electron and wraps it with the existing `NativePort`.
- The Native SDK adapter package will fail fast on required native capabilities instead of allowing kiosk boot to proceed with missing capabilities.
- CEN/XFS capabilities will not be added to the Native SDK requirements document as native APIs. They remain optional provider capabilities wrapped by Device Services.
- A new XFS Device Service package will own all runtime use of `@tripley-kit/xfs-client`.
- The XFS Device Service package will be the only production framework package allowed to import `@tripley-kit/xfs-client`.
- A new XFS Test Harness package will own all use of `@tripley-kit/xfs-control-client`.
- The XFS Test Harness package will be test-only and must not be included in production kiosk presets.
- `@tripley-kit/xfs-client` needs a stable public facade for all supported generated module clients before framework wrapping proceeds.
- The public XFS facade should expose manager, IDC, PIN, BCR, CDM, CIM, PTR, SIU, TTU, and VDM module clients or support explicit required module selection.
- The framework must not deep import generated Tripley Kit client files.
- XFS logical service names are project configuration, not framework device ids.
- Framework device ids are stable application-facing names such as card reader, pinpad, barcode reader, and cash dispenser.
- The XFS Device Service will map configured logical service names to framework device ids.
- The XFS Device Service will own XFS startup, session open, registration, locking, unlocking, cancellation, close, cleanup, and disposal lifecycle.
- The first implemented XFS runtime vertical slice will cover IDC, PIN, and BCR.
- CDM support will be designed now but implemented after the first input/auth milestone unless explicitly prioritized.
- IDC will be exposed through a Card Reader Device Port.
- PIN data input will be exposed through a Pinpad Data Device Port.
- PIN secure input will be exposed through a Pinpad PIN Device Port.
- BCR QR scanning will be exposed through a Barcode Reader Device Port.
- CDM dispense will later be exposed through a Cash Dispenser Device Port.
- Input source adapters will be registered through `InputSourceRegistry`; the UserInput executor will not gain hard-coded XFS or device-specific branches.
- Built-in XFS-backed input source kinds will include `pinpad.data`, `pinpad.pin`, `barcodeReader.qr`, and a card reader source kind.
- Secure PIN input must return encrypted or tokenized data plus safe summary only.
- Secure PIN input must not write raw PIN digits into UI state, logs, flow traces, tests, audit records, or transaction messages.
- QR and card input are sensitive data and must use safe summaries in logs by default.
- XFS command completion codes will be translated into framework result or error shapes at the Device Service boundary.
- Raw XFS `hResult` values may appear in diagnostic metadata only when redacted and classified safely.
- Device health checks will be registered for every configured logical service.
- XFS device events will be translated to existing framework event topics such as card inserted, card removed, status changed, cash unit empty, and SIU headphone events.
- Flow interrupt policies will consume framework event topics rather than raw XFS events.
- Device locks will coordinate framework operations before XFS commands are issued.
- `InputSourceSession.cancel()` will call the appropriate XFS cancellation operation.
- Active XFS sessions must be cancelled on timeout, interrupt, node exit, and losing input source races.
- The kiosk example will support hostd-backed mode and in-memory mode.
- In-memory mode remains the default path for fast CI and development without simulator.
- Hostd-backed mode will demonstrate browser WebSocket transport with native and XFS clients.
- Simulator automation will configure state through xfs-control before exercising runtime XFS commands.
- Project-specific device plugins will register through existing extension registries and must not modify core packages.
- Hostd URL, auth token, service list, and logical service mapping belong in configuration or project preset inputs.
- Production presets must not enable or depend on xfs-control.
- Test presets may require a running hostd or may optionally manage hostd startup as a later enhancement.

## Testing Decisions

- The highest-value test seam is the hostd-backed kiosk example running through framework Flow, Command, Device, InputSource, UI state, audit, and logging behavior.
- The primary integration seam is the XFS Device Service boundary: DeviceRegistry registration, InputSourceRegistry registration, health checks, event mapping, cancellation, and safe summaries.
- Unit tests should cover external behavior at framework ports and adapters, not private implementation details or raw generated client internals.
- Existing prior art includes Flow test runner tests, DeviceRegistry/InputSourceRegistry tests, CommandRegistry tests, kiosk base tests, and UI state adapter tests.
- Native adapter tests should verify successful connection wrapping and required capability failure behavior.
- XFS Device Service tests should use fake Tripley XFS clients for unit-level behavior.
- XFS Test Harness tests should use simulator control only in integration tests marked as simulator-dependent.
- Browser smoke tests should connect to hostd over WebSocket to prove the same transport path used in manual kiosk development.
- Tests must prove dynamic `minLength` and `maxLength` options work with XFS-backed PIN pad data input.
- Tests must prove local validation failure stays on the same UserInput node and updates UI feedback.
- Tests must prove business validation can reenter the input node after host or project validation failure.
- Tests must prove secure PIN input logs only safe summary metadata.
- Tests must prove timeout cancels active XFS input sessions.
- Tests must prove interrupt cancels active XFS input sessions.
- Tests must prove node exit cancels active XFS input sessions.
- Tests must prove optional QR input can lose an input race and still be cancelled.
- Tests must prove optional QR input can win an input race and produce a safe result.
- Tests must prove simulator card removal maps to the framework card removal interrupt.
- Tests must prove a project-specific custom input device plugin works without modifying core.
- Tests must prove xfs-control-client is absent from production package dependencies.
- Tests must prove missing required XFS module clients fail with clear errors.
- Tests must prove missing native window/display capability fails before kiosk boot.
- Tests must not assert private class names, internal maps, generated XFS method ids, or implementation-specific ordering unless externally visible.

## Out of Scope

- Building or changing the Rust `tripley-native-hostd` implementation except where explicit compatibility issues are discovered.
- Implementing all CDM dispense, present, retract, and cash unit accounting behavior in the first milestone.
- Implementing CIM cash-in workflows in the first milestone.
- Implementing receipt printer rendering and form layout in the first milestone.
- Implementing SIU indicator and sensor control beyond event mapping and health status in the first milestone.
- Implementing production cryptographic key management beyond safely passing configured PIN options and redacting secure input.
- Shipping simulator control APIs in production kiosk applications.
- Replacing the existing Flow Engine, Command System, UI abstraction, or Device Abstraction Layer.
- Adding raw XFS calls to application code.
- Adding raw XFS calls to UserInputNodeExecutor.
- Making React Router a dependency of any native or XFS service package.
- Guaranteeing CI can run Windows simulator integration tests without a configured simulator environment.

## Further Notes

The current `@tripley-kit/xfs-client` package appears to generate module clients for the required simulator-supported modules, but its public top-level facade currently exposes only manager and IDC through the main client shape. This must be corrected upstream before the framework should build production wrappers for PIN, BCR, CDM, CIM, PTR, SIU, TTU, and VDM.

The recommended first milestone is IDC, PIN, and BCR over hostd WebSocket. This proves the framework's most important kiosk development risks: native connection, XFS session lifecycle, card events, dynamic input, optional QR input, secure PIN, cancellation, safe logging, simulator automation, and project extension without core modification.

The open decisions that should be resolved before implementation starts are:

- Which logical service names are canonical for the installed simulator on the target PC.
- Whether tests should start hostd or assume hostd is already running.
- Whether the first product vertical slice is card-first withdrawal, QR-first withdrawal, or no-card withdrawal.
- Whether PIN key slots and PIN block format are project configuration, bank plugin configuration, or environment secrets.
- Whether raw XFS `hResult` codes are ever exposed to business validation nodes or always normalized into framework error codes.
- Whether the development environment requires x86 hostd for all simulator tests or keeps a mock XFS provider for CI.
