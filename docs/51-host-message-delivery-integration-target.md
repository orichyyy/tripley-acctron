# Target 51: Host Message Delivery Integration

## Objective

Bind project-owned Host Message profiles to durable host delivery without coupling the delivery core to ISO8583, fixed-field formats, or a specific bank transport.

## Decisions

- A `HostMessageBinding` owns profile/version references, field projection, response mapping, delivery policy, and safe request summary.
- Request summaries are explicit project code. The framework never derives an outbound summary from fields that may contain PAN, PIN blocks, tokens, or credentials.
- `HostMessageTransportAdapter` decodes responses only to create profile-governed safe summaries. Raw payloads remain encrypted in the Target 50 payload vault.
- A response is usable by business code only after durable reconciliation and a complete Host Message decode.
- Partial or failed decode is a protocol failure, not an approval or a generic network failure.
- `notSent` may follow the configured retry policy. `unknown` is never retried blindly and remains an investigable uncertain delivery.
- TCP and WebSocket adapters call one configurable native request/response method. That native method must atomically report `response`, `notSent`, or `unknown` certainty.
- No browser socket or `window` fallback is permitted.
- Withdrawal and deposit adapters translate orchestration ports to bindings. Host Financial Completion is omitted when the project does not configure a completion binding; local finalization remains independent.

## Extension contract

A project adds a message format, bank protocol, or transport by registering bindings and adapters. Core source changes are not required. Bindings are immutable after startup freeze and are resolved by stable IDs.

## Acceptance

- Fixed-field and ISO8583 request/response exchanges use the Host Message service.
- Durable response replay does not send the request again.
- Secure request summaries contain only project-approved metadata.
- Unknown delivery certainty remains distinguishable from protocol decode failures.
- Custom wire transports register without core modification.
- Withdrawal and deposit host posting ports are supplied by bindings.
