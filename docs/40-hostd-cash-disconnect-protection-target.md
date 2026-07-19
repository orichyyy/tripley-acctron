# Hostd Cash Disconnect Protection Target

## Goal

Close the stale-runtime safety gap for compound cash hardware by enforcing CDM/CIM resource-group ownership at host dispatch and by executing bounded, journaled protection after owner transport loss.

## Public contract

- Lease acquisition binds host epoch, logical service, operation, fencing token, authority, resource group, runtime owner identity, reconnect proof, and frozen configuration hash.
- A lost connection enters `suspect`; only the same owner identity and reconnect proof can rebind before grace expires.
- Grace expiry advances fencing and enters host-internal `protection` authority before any protective side effect.
- Status, safe journal query, and explicit application recovery acknowledgement are exposed through the command-lease facade.

## Host configuration

Hostd loads `--xfs-protection-file` or `TRIPLEY_NATIVE_HOSTD_XFS_PROTECTION_FILE` at startup. Configuration declares resource-group members, grace duration, SQLite journal path, and exactly one closed-vocabulary disconnect action per group. Unknown fields, duplicate mappings, module/action mismatch, empty identifiers, and invalid timeouts fail startup.

## Closed action vocabulary

- `intervention`
- `cimRollback`
- `cimRetract`
- `cdmRetract`
- `idcEject`
- `idcRetain`

Hostd cannot dispense, present, start cash acceptance, physically commit CIM escrow, invoke host messages, or execute arbitrary native commands under protection authority.

## Crash safety

- SQLite intent is durable before dispatch.
- A duplicate or incomplete intent is never automatically dispatched again.
- Journal failure retains fencing and causes intervention.
- Host restart imports unresolved journal groups as blocked until application recovery acknowledges them.
- Journal records contain identifiers, action names, fencing values, and safe outcomes only.

## Done when

- Same-group CDM/CIM leases are mutually exclusive while independent groups remain usable.
- Stale owner and stale fencing tokens are rejected at dispatch.
- Same-owner rebind succeeds only during grace.
- Grace expiry permanently stales the old owner and dispatches at most one configured action.
- Restart never repeats an execution-unknown action.
- Client and application adapters expose the contract without hard-coded logical service names.
- Unit, package, Rust workspace, and isolated hostd smoke tests pass.
