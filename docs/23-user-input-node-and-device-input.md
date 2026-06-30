# 23. UserInput Node and Device Input

## Purpose

Avoid duplicated device input code in every Flow node. `userInput` nodes declaratively specify what input is needed and which sources can provide it. The executor handles device start/cancel, timeout, interrupt, validation, UI feedback, TTS, audit, and cleanup.

## Principles

- Input devices are extensible through `InputSourceRegistry`.
- Built-in pinpad/barcode/UI command sources are not hardcoded special cases.
- Secure input forbids plain fallback and raw logging.
- Dynamic input options are supported.
- Local validation stays in the node; business validation is separate node.

## Input source kinds

Built-ins:

```text
pinpad.data
pinpad.pin
barcodeReader.qr
ui.command
```

This list is not closed. Project plugins can add kinds such as:

```text
bank.idCardReader.identity
bank.palmScanner.identity
bank.mobilePushApproval
```

## InputSourceAdapter

```ts
export interface InputSourceAdapter<TOptions = unknown, TResult extends UserInputSourceResult = UserInputSourceResult> {
  kind: string;
  contractVersion?: string;
  dataClassification?: DataClassification;
  validateDefinition?(source: UserInputSourceDefinition<TOptions>): Promise<void> | void;
  canStart(ctx: UserInputExecutionContext, source: UserInputSourceDefinition<TOptions>): Promise<boolean>;
  start(ctx: UserInputExecutionContext, source: UserInputSourceDefinition<TOptions>): Promise<InputSourceSession<TResult>>;
}

export interface InputSourceSession<TResult extends UserInputSourceResult = UserInputSourceResult> {
  id: string;
  sourceId: string;
  sourceKind: string;
  result: Promise<TResult>;
  cancel(reason?: string): Promise<void>;
}
```

## Dynamic input profile

Dynamic profile solves cases where previous node selected account type and min/max length changes.

```ts
export interface InputProfile {
  id: string;
  promptKey: string;
  constraints: { minLength?: number; maxLength?: number; inputMode?: 'numeric' | 'text' | 'tel' | 'decimal' };
  sourceOptions: Record<string, unknown>;
  validatorId?: string;
  errorMessageKeys?: Record<string, string>;
}
```

Example:

```ts
defineUserInputNode({
  id: 'enterAccountIdentifier',
  input: {
    profile: async ctx => {
      const type = ctx.scopedStore.scope('flow').getOrThrow<'nationalId' | 'mobilePhone'>('account.type');
      return ctx.inputProfiles.get(`account.${type}`);
    },
    ui: profile => ({ path: '/account/input', stateKey: 'account.input', promptKey: profile.promptKey }),
    sources: profile => [
      { id: 'pinpad', kind: 'pinpad.data', required: true, options: profile.sourceOptions.pinpadData },
      ...(profile.sourceOptions.barcodeQr ? [{ id: 'mobileQr', kind: 'barcodeReader.qr', required: false, enabledWhen: 'device.barcodeReader.available', options: profile.sourceOptions.barcodeQr }] : [])
    ],
    validation: profile => ({
      validatorId: profile.validatorId,
      failure: { mode: 'stayOnNode', maxAttempts: 3, ui: { errorMessageKey: profile.errorMessageKeys?.invalidFormat, clearInput: true } }
    })
  },
  next: 'verifyAccountIdentifierWithHost'
});
```

## Plain input example

Amount/account/phone input can race multiple sources:

```ts
sources: [
  { id: 'pinpad', kind: 'pinpad.data', required: true, options: { dataType: 'numeric', minLength: 1, maxLength: 10 } },
  { id: 'mobileQr', kind: 'barcodeReader.qr', required: false, enabledWhen: 'device.barcodeReader.available', options: { formats: ['qr'], parseAs: 'mobileAppInput' } },
  { id: 'screenCommand', kind: 'ui.command', required: false, commandId: 'withdrawal.amount.confirmed' }
],
acceptance: { mode: 'race', firstValidWins: true }
```

The first valid source wins; losing sources are cancelled.

## Secure input example

```ts
defineUserInputNode({
  id: 'enterPin',
  input: {
    semantic: 'pin',
    security: 'secure',
    ui: { path: '/auth/pin', stateKey: 'auth.pinInput' },
    sources: [{ id: 'pinpad', kind: 'pinpad.pin', required: true, options: { minLength: 4, maxLength: 12, pinBlockFormat: 'ISO9564-0', keySlot: 'bank.default' } }],
    acceptance: { mode: 'single' },
    cleanup: { cancelDevicesOnExit: true },
    trace: { safeToLog: false, summaryOnly: true }
  },
  next: 'verifyPin'
});
```

Secure result must be encrypted/tokenized:

```ts
export interface SecurePinInputResult {
  kind: 'securePin';
  encryptedPinBlock: string;
  ksn?: string;
  keyId?: string;
  pinBlockFormat?: string;
  source: { kind: 'pinpad.pin'; deviceId: string };
  safeSummary: { sourceKind: 'pinpad.pin'; hasEncryptedPinBlock: true; pinBlockFormat?: string };
}
```

## Validation strategy

Local validation:

```text
phone format
account length
amount min/max
checksum
QR parse
required value
```

Use `stayOnNode`: patch UI state with error, optionally TTS, increment attempts, restart input.

Business validation:

```text
host account lookup
customer status check
risk/limit check
message with audit/transaction record
```

Use a separate node. On failure, reenter input node with error context.

## Validation result

```ts
export interface UserInputValidationResult<T = unknown> {
  valid: boolean;
  value?: T;
  reasonCode?: string;
  messageKey?: string;
  messageParams?: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'error';
  fieldErrors?: Array<{ field: string; reasonCode: string; messageKey: string; messageParams?: Record<string, unknown> }>;
  safeSummary?: Record<string, unknown>;
}
```

Validator does not mutate UI. Executor turns result into UI feedback.

## Executor lifecycle

```text
1. resolve input profile/options
2. validate definition
3. acquire device locks
4. navigate UI and set input state
5. start required sources
6. start optional enabled sources
7. wait for result / timeout / interrupt / cancel
8. validate result
9. cancel losing/active sessions
10. release device locks
11. return FlowNodeResult
```

Finally cleanup always executes.

## Extending with new device

Project plugin registers a device and input source adapter. Core does not change.

```ts
ctx.devices.register('idCardReader', createIdCardReaderDevice(ctx.native.extensions));
ctx.inputSources.register('bank.idCardReader.identity', new IdCardReaderInputSourceAdapter());
```

Flow uses:

```ts
{ id: 'idCardReader', kind: 'bank.idCardReader.identity', required: true, options: { acceptedDocumentTypes: ['nationalId', 'passport'] } }
```
