# Target 53 Findings

- Target 52 exposes structural `NativeTcpApi` and `HostFrameCodec` contracts suitable for reuse.
- Target 51 consumes only `HostWireTransportAdapter`, so a persistent session can replace the atomic adapter without changing durable delivery.
- The existing native TCP API emits connection, data, close, and error events keyed by socket id.
- The BSP simulator and specification have both ATM-to-FEP and FEP-to-ATM directions; unsolicited inbound routing is a real production boundary.
- Message recognition must remain application-owned. The session requires an injected frame router rather than inspecting BSP `TXCODE`.
- The host wire contract permits one response or a conservative failure result. Serializing outbound exchanges avoids generic correlation assumptions while still allowing inbound frames during a pending exchange.
