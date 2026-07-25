# Target 62: Taiwan BSP Withdrawal Simulator Smoke

## Status

Implemented.

## Purpose

Prove that the BSP v2.43 project modules form one executable kiosk withdrawal
path with the real hostd, XFS simulator, and BSP host simulator.

The smoke covers:

1. XFS IDC simulator card insertion and Track 2 read
2. secure XFS PIN input and encrypted PIN block capture
3. Target 61 operation context assembly
4. OEX session establishment and IWD authorization over native TCP
5. IDC card eject and customer take
6. CDM dispense, present, and customer take
7. IWF host financial completion
8. durable transaction finalization and safe diagnostic output

## Project card mapping

`taiwan-contact-card-context.ts` is the Taiwan BSP project adapter. It:

- reads configurable XFS IDC Track 2 source data
- validates the BSP project requirement for a 16-digit PAN
- delegates transaction-account resolution to the bank project
- maps Track 2 into the BSP 104-byte track field
- registers through `BspCredentialMapperRegistry`

The generic operation assembler and XFS device service contain no Taiwan
account parsing rule.

## Safety

The smoke is disabled by default. It runs only when both values are set:

```powershell
$env:TARGET62_SIMULATOR_SMOKE = "1"
$env:TARGET62_SIMULATOR_CONFIRM = "I_UNDERSTAND_SIMULATOR_ONLY"
```

The confirmation prevents accidental execution against a production device.
The diagnostic event contains logical service names, custody outcomes, mapper
ID, and host session state. It does not print PAN, Track 2, customer data, PIN
digits, encrypted PIN block, ATM check, or MAC.

The default `00000000` ATM check and MAC belong only to the explicitly
confirmed simulator composition. Production configuration must replace the
`BspRequestSecurityPort` with the bank security/HSM adapter.

## Prerequisites

- `tripley-native-hostd` listening at `ws://127.0.0.1:39010`
- hostd services include runtime, TCP, XFS, XFS control, IDC, PIN, and CDM
- XFS simulator PIN key is initialized
- BSP host simulator listens at `127.0.0.1:12008`
- the BSP simulator is configured for the 3-byte BCD length prefix and
  `0F 0F 0F` fixed header

## Command

```powershell
$env:TARGET62_SIMULATOR_SMOKE = "1"
$env:TARGET62_SIMULATOR_CONFIRM = "I_UNDERSTAND_SIMULATOR_ONLY"
$env:TRIPLEY_NATIVE_HOSTD_URL = "ws://127.0.0.1:39010"
$env:BSP_V243_SIMULATOR_PORT = "12008"
pnpm exec vitest run apps/kiosk-example/script/bsp-v243/target62-withdrawal-simulator.smoke.test.ts
```

Optional project settings include:

- `BSP_V243_ATM_ID`
- `BSP_V243_BANK_NUMBER`
- `BSP_V243_TRANSACTION_ACCOUNT`
- `BSP_V243_WITHDRAWAL_SEQUENCE`
- `BSP_V243_CURRENCY_CODE`
- `BSP_V243_MAC`
- `BSP_V243_TERMINAL_CHECK`
- `TRIPLEY_XFS_IDC_LOGICAL_NAME`
- `TRIPLEY_XFS_PIN_LOGICAL_NAME`
- `TRIPLEY_XFS_PIN_KEY_NAME`
- `TRIPLEY_XFS_PIN_CUSTOMER_DATA`
- `TARGET62_IDC_RESOURCE_GROUP`
- `TARGET62_PIN_RESOURCE_GROUP`
- `TARGET62_CDM_RESOURCE_GROUP`

## Failure evidence

The existing typed withdrawal and host boundaries preserve distinct outcomes
for host decline, operation timeout, uncertain transport delivery, protocol
decode failure, card custody failure, and cash custody failure. Target 62 emits
only the safe error name/category/code/message or the safe withdrawal outcome.
The durable delivery and transaction stores remain the source of evidence for
reconciliation.
