# Target 53: Persistent Duplex Host Session Runtime

## Objective

Provide a production-oriented persistent native TCP session for kiosk host messaging without coupling transport core to a bank message format.

## Boundary

- The runtime implements Target 51 `HostWireTransportAdapter`.
- It reuses Target 52 `NativeTcpApi`, native security, and `HostFrameCodec` contracts.
- Project code supplies a synchronous frame router that classifies a complete payload as a response, an unsolicited inbound message type, or an ignored frame.
- An open inbound registry owns project handlers and same-session replies.

## Certainty

| Stage | Result |
|---|---|
| Encode or connect failure before write dispatch | `notSent` |
| Native write begins | delivery may have occurred |
| Write failure, remote disconnect, response timeout, or dispose after dispatch | `unknown` |
| Routed pending response | `response` |

The runtime never retries an outbound business request. Reconnect restores channel availability for later work; durable delivery and reconciliation remain responsible for uncertain requests.

## Duplex rules

- Only one outbound exchange is pending at a time unless a later protocol-specific correlator replaces this policy.
- Any write or response-timeout ambiguity retires the current connection before later work can start, preventing a late response from being correlated to another exchange.
- Inbound frames may be handled while an outbound response is pending.
- Replies use the same socket id and generation that received the inbound request.
- A reply is rejected after reconnect rather than being sent on a different host session.
- Coalesced frames are drained in order and fragmented frames remain buffered within the current generation.

## Lifecycle

- Explicit `start()` establishes the initial persistent connection.
- Remote close/error schedules bounded reconnect while the runtime remains started.
- Every successful connection increments a generation.
- Events from retired socket ids and replies bound to old generations are rejected.
- `dispose()` cancels reconnect, resolves pending work conservatively, closes the active socket, and removes the native event subscription.
- Lifecycle notifications contain state, generation, timestamps, error codes, and inbound type only. Payload bytes are prohibited.

## Extension hooks

Lifecycle subscribers can contribute sign-on, echo, heartbeat, and diagnostics behavior without transport changes. Bank-specific recognition, message packing, and inbound command handling remain application script contributions.

## Acceptance

- Multiple exchanges reuse one native socket.
- Fragmented and coalesced frames are processed correctly.
- Unsolicited inbound dispatch does not consume a pending response.
- Disconnect after dispatch returns `unknown` and does not retry the request.
- Reconnect advances generation and ignores stale events/replies.
- Missing inbound handlers and lifecycle failures expose safe metadata only.

## Simulator smoke

`pnpm test:host-simulator` starts an isolated native hostd and sends two BSP `AEX` exchanges through one persistent connection to `127.0.0.1:12008`. A passing summary reports two responses and `generation: 1`; payload bytes are never logged.
