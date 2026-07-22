# Target 53: Persistent Duplex Host Session Runtime

## Objective

Add a persistent, duplex native TCP host session that implements the existing host wire transport contract while supporting unsolicited host messages, bounded reconnect, generation fencing, safe lifecycle events, and project-owned frame routing.

## Phases

1. **Session and extension contracts** - complete
2. **Persistent exchange and frame processing** - complete
3. **Inbound registry and same-session reply** - complete
4. **Reconnect, generation fencing, and shutdown** - complete
5. **Composition and simulator vertical smoke** - complete
6. **Validation, review, commit, and publish** - complete

## Required behavior

- Core never recognizes BSP transaction codes or message fields.
- A project-supplied router classifies complete frames as responses, inbound messages, or ignored frames.
- One persistent socket supports multiple serialized exchanges.
- Fragmented and coalesced frames are decoded without losing frame boundaries.
- Unsolicited inbound frames are dispatched while an outbound response is pending.
- Inbound handlers can reply on the same fenced connection generation.
- Connect failures before dispatch are `notSent`; write, disconnect, timeout, and shutdown after dispatch are `unknown`.
- Reconnect uses bounded backoff and rejects retired or stale socket events.
- Lifecycle events contain only safe metadata and never raw payloads.
- Existing Target 52 per-exchange adapters remain behaviorally compatible.

## Errors

| Error | Attempts | Resolution |
|---|---:|---|
| Persistent session tracer could not resolve the new modules | 1 | Expected RED; implement the public contracts, inbound registry, and minimum persistent session. |
| Typecheck narrowed an empty receive buffer to `Uint8Array<ArrayBuffer>` | 1 | Widen the persistent receive buffer with an explicit `Uint8Array` annotation. |
| Late-connect RED test attached its rejection assertion after advancing fake time | 1 | Attach the rejection assertion before advancing time, then implement late-socket close. |
| Router-failure containment patch had a malformed cross-file hunk | 1 | Split implementation and progress updates into independent patches. |
| Inbound-reply certainty patch repeated the cross-file hunk parse failure | 1 | Apply contract, implementation, and planning changes as separate patches. |
| PowerShell did not expand the Vitest `persistent-*.test.ts` argument | 1 | Run Vitest against the package `src` directory instead of a shell glob. |
| Persistent simulator smoke patch did not match Biome-formatted context | 1 | Re-read only the failed script and apply the exact persistent-session replacement. |
| Biome rejected an implicitly typed router result local | 1 | Annotate the catch-boundary local with `PersistentHostFrameRoute`. |
| The guessed kiosk-example package-name filter matched no workspace project | 1 | Rely on root recursive typecheck, which includes the application by path. |
