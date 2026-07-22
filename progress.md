# Target 53 Progress

- 2026-07-22: Started Target 53 and confirmed the persistent session can implement the existing HostWireTransportAdapter boundary.
- 2026-07-22: Selected project-owned frame routing, serialized outbound exchanges, same-session inbound replies, bounded reconnect, and connection-generation fencing.
- 2026-07-22: First persistent-session tracer reached expected RED because the new public modules did not exist; added minimum contracts, inbound registry, and persistent session implementation.
- 2026-07-22: Persistent connection reuse tracer is GREEN; coalesced unsolicited inbound dispatch and same-generation reply passed through a custom registry handler.
- 2026-07-22: Reconnect tracer reached expected RED at the missing lifecycle subscription seam; added bounded reconnect, safe lifecycle events, retired socket fencing, and generation advancement.
- 2026-07-22: Unhandled-inbound lifecycle tracer reached RED because dispatch results were ignored; added safe unhandled/failed events bound to the receiving generation.
- 2026-07-22: Late-connect tracer reached RED and initially exposed a test rejection-order issue; corrected the test and added deterministic late-socket cleanup.
- 2026-07-22: Project-router failure tracer reached RED as `write-failed`; contained router errors as protocol failures, added frame-consumption bounds, and surfaced orphan responses safely.
- 2026-07-22: Stale inbound-reply tracer reached RED on certainty classification; stale generation and local framing failures now return proven `notSent`, while write-stage failures remain `unknown`.
- 2026-07-22: Persistent runtime registration reached expected RED; added capability fail-fast, registry contribution, aggregate start/dispose, and lazy native event subscription.
- 2026-07-22: Exported persistent APIs, added injectable kiosk-example composition, and converted the real simulator smoke to two exchanges on one persistent generation.
- 2026-07-22: Response-timeout reconnect tracer reached RED because the ambiguous socket remained active; all dispatch-stage ambiguity now retires and closes the generation before reconnect, and public state is read-only.
- 2026-07-22: Dispose-during-connect tracer reached RED because connect catch overwrote the terminal state; disposed is now terminal while late sockets are still closed.
- 2026-07-22: Real hostd-to-BSP-simulator smoke passed two 726-byte `AEX` exchanges on one persistent connection generation.
- 2026-07-22: Final review found the session file at 390 lines; extracted connection/config/certainty support and lifecycle emission into focused modules before commit.
- 2026-07-22: The first split left 334 lines, so inbound dispatch and fenced reply handling were extracted into a dedicated coordinator.
- 2026-07-22: Post-split package validation passed typecheck, Biome, and 27 tests across 16 files; the focused session module is 281 lines.
- 2026-07-22: Full workspace validation before the final responsibility split passed 68 test files, 239 tests, and all builds; the real simulator smoke passed two exchanges on generation 1.
