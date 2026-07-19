# Hostd Cash Disconnect Protection

## Objective

Implement host-backed CDM/CIM shared resource-group command leasing and bounded disconnect protection across tripley-native, tripley-kit, and tripley-acctron.

## Phases

1. **Repository seam discovery** - complete
2. **Public contract tests** - complete
3. **Host resource-group leasing and durable protection journal** - complete
4. **Client facade and application adapters** - complete
5. **Simulator smoke, full builds/tests, review, commits** - in progress

## Required behavior

- CDM and CIM in one configured resource group are mutually exclusive.
- Host epoch and fencing token reject stale owners.
- Disconnect enters suspect/grace before irreversible protection activation.
- Same owner may recover during grace using a reconnect proof.
- Activated protection actions use a closed whitelist and execute at most once.
- Protection intent and outcomes survive hostd restart in SQLite.
- Invalid safety configuration fails hostd startup.

## Errors

| Error | Attempts | Resolution |
|---|---:|---|
| Parallel status orchestration syntax error | 1 | Corrected the JavaScript object field syntax before running repository commands. |
| Assumed xfs-client lease test lived under src | 1 | Locate only `*lease*.test.ts` beneath the library before reading it. |
| Combined findings/read orchestration syntax error | 1 | Separate patch recording from parallel source reads. |
| Acctron consumes old published xfs-client declarations | 1 | Add a temporary compatible declaration merge at the adapter seam until the changed package is published. |
| Duplicate serde dependency in tripley-native-xfs Cargo.toml | 1 | Remove the newly added duplicate and retain the existing workspace dependency. |
| NativeState SQLite guard made cleanup future non-Send | 1 | Bound the synchronous mutex guard to a lexical block before provider awaits. |
| Command-lease split PowerShell quote parsing | 1 | Use single-quoted code fragments and regex newline matching; overwrite the harmless partial RPC copy. |
| Command-lease split PathInfo directory property | 1 | Use `Split-Path` and recover the original test block from `git show HEAD:<path>`. |
| Protection test used RuntimeError code as method | 1 | Compare the public `code` field and remove the duplicate extracted import. |
| Completed protection action unlocked group after restart | 1 | Treat every non-acknowledged journal outcome as unresolved; physical completion is not business recovery. |
| Rust high-watermark sibling borrow conflict | 1 | End the lease borrow before updating state and reacquire after activation validation. |
| Borrow-fix patch contained empty hunk | 1 | Remove the empty marker and reapply atomically. |
| Combined hostd smoke lifecycle command blocked by policy | 1 | Use separate build, hidden start with returned PID, smoke, and exact-PID stop commands. |
| Smoke SQLite cleanup command blocked by policy | 1 | Preserve the journal and make the test reconcile prior smoke records before using unique identifiers. |
