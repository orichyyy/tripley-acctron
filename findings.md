# Findings

Repository findings and design constraints for the hostd cash disconnect-protection target.

- `tripley-native-xfs/src/command_lease.rs` is already 808 lines. New resource mapping, disconnect state, and journal responsibilities must be extracted into focused modules before integration.
- The previously assumed `tripley-native-core/src/provider.rs` and `server.rs` paths do not exist; locate their definitions by symbol rather than enumerating the repository.
- Existing xfs-client lease tests are not named `*lease*.test.ts`; locate by the public lease symbols.
- `XfsCommandLeaseClient` currently uses RPC methods 1-6 and a six-field lease response. Bindings are keyed by logical service and reconnect currently requires a fresh recovery acquire.
- `CommandLeaseRegistry` currently owns one state and command gate per logical service; sessions map only session ID to logical service.
- `NativeRpcProvider` and the connection cleanup sink both live in `tripley-native-core/src/lib.rs`.
- The XFS backend already exposes CIM rollback/retract, CDM retract, and IDC eject/retain commands needed by the closed protection vocabulary.
- xfs-client public behavior tests are concentrated in `libs/xfs-client/test/xfs-client.test.mjs`.
- `NativeState` is the only connection cleanup sink and currently does not retain providers; provider cleanup must be aggregated there.
- XFS protection can call the existing backend through typed requests: CIM rollback/retract, CDM retract, IDC eject/retain all accept session IDs and bounded `u32` timeouts.
- Production configuration will use a closed serde-tagged action enum. Unknown actions therefore fail startup deserialization rather than reaching dispatch.
- Isolated hostd smoke on port 39011 proved transport cleanup, grace activation, fencing increment, durable journal query, explicit acknowledgement, and clean same-group reuse without touching the user's port 39010 process.

## Completion findings
- Host protection journal remains blocked after physical action until explicit application acknowledgement.
- Shared CDM/CIM resource-group fencing advances across clean release and protection takeover.
- Generated smoke logs and SQLite journals are ignored under .tmp/.
