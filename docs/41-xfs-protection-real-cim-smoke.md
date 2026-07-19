# Real XFS CIM Protection Smoke

This smoke proves that a hostd-backed CIM cash-in operation is rolled back by host protection after the owning application connection disappears.

## Safety boundary

Run this only against XFS Simulator. The script refuses to move cash unless this exact confirmation is present:

```powershell
$env:XFS_REAL_PROTECTION_SMOKE='I_UNDERSTAND_SIMULATOR_ONLY'
```

A failed protection action remains in `intervention` and is not acknowledged automatically. Investigate the journal before retrying. To acknowledge an existing investigated record before a repeat run, explicitly set:

```powershell
$env:XFS_PROTECTION_ACK_EXISTING='1'
```

## Hostd prerequisites

Build the current i686 hostd and restart the simulator host from the application repository so the relative SQLite journal path is stable:

```powershell
Set-Location E:\code\apps\tripley-acctron

E:\code\rust\tripley-native\target\i686-pc-windows-msvc\debug\tripley-native-hostd.exe `
  --transport websocket `
  --addr 127.0.0.1:39010 `
  --services runtime,xfs,xfs-control `
  --xfs-dll-directory K:\ATMdoc\dll `
  --xfs-command-leases required `
  --xfs-protection-file E:\code\apps\tripley-acctron\config\xfs-protection.real-smoke.json
```

The simulator protection config maps its actual `CIM` and `CDM` logical services to
`cash-transport-1` and configures `cimRollback`. It is intentionally separate from
the project example, which uses project-configurable logical service names.

The smoke temporarily converts the matching simulator cash unit to a recycling
unit and reserves capacity because the simulator's default `CNY 100` unit is a
reject unit. The complete original cash-unit configuration is restored before a
successful intervention is acknowledged. A post-disconnect protection failure
leaves both the intervention and fixture intact for investigation.

## Run

From `E:\code\front-end\tripley-kit`:

```powershell
$env:XFS_REAL_PROTECTION_SMOKE='I_UNDERSTAND_SIMULATOR_ONLY'
node scripts/xfs-protection-real-cim-smoke.mjs
```

Optional settings:

- `XFS_HOSTD_URL`, default `ws://127.0.0.1:39010`
- `XFS_CIM_LOGICAL_SERVICE`, default `CIM`
- `XFS_CASH_RESOURCE_GROUP`, default `cash-transport-1`
- `XFS_CIM_CURRENCY`, default `CNY`
- `XFS_CIM_VALUE`, default `100`
- `XFS_CIM_COUNT`, default `1`
- `XFS_COMMAND_TIMEOUT_MS`, default `5000`
- `XFS_PROTECTION_TIMEOUT_MS`, default `30000`

## Assertions

The script proves:

- simulator cash-unit state is saved, temporarily configured for recycling with
  capacity, and restored;
- simulator control stages the configured note bunch;
- at least one staged note is accepted before owner disconnect;
- the application acquires the shared cash resource-group lease;
- CIM cash-in starts and accepts the staged bunch;
- disconnecting the lease owner invokes host-owned `cimRollback`;
- the protection journal reaches `completed`;
- CIM cash-in status reaches `WFS_CIM_CIROLLBACK`;
- simulator control takes the returned items and verifies the output position is empty;
- acknowledgement clears the resource group back to `idle`.
