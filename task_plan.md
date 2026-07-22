# Target 54: Host Session Supervisor

## Objective

Implement transport-neutral host protocol supervision above persistent duplex sessions.

## Phases

1. **Contracts and package boundary** - complete
2. **State machine, control timeout, and generation fencing** - complete
3. **Heartbeat, retry, registry, and runtime** - complete
4. **Condition, health, and project extension tests** - complete
5. **Validation, review, commit, and publish** - complete

## Required behavior

- Core does not contain BSP transaction codes or message fields.
- Connected is distinct from ready.
- Disconnect and disposal cancel active work.
- Late operations are fenced by generation and operation epoch.
- Events contain safe metadata only.
- Optional and required startup policies are explicit.

## Errors

| Error | Attempts | Resolution |
|---|---:|---|
| Initial package typecheck rejected boolean unsubscribe results and exact optional assignments | 1 | Return void from subscriptions and declare clearable fields with explicit undefined unions. |
| Timeout abort ordering reported cancellation instead of timeout | 1 | Settle the timeout result before aborting the project hook signal. |
| Vitest could not resolve the new package's workspace dependencies | 1 | Run a normal workspace install instead of lockfile-only installation. |
| Heartbeat test observed state before the async control chain settled | 1 | Drain the deterministic test scheduler's complete microtask chain. |
| Biome rejected formatting and a fixture assignment expression | 1 | Use an explicit cancel body and apply repository formatting. |
| Full validation was initially launched with a one-second process timeout | 1 | Re-run with the normal 120-second limit; typecheck, tests, and builds passed. |
