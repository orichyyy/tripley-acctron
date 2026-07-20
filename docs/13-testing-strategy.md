# 13. Testing Strategy

## Tooling

- Test runner: Vitest.
- Mock layer: native SDK, window/display, Event Bus, Flow, Device, UI, Configuration.
- Contract tests for plugins and extension adapters.
- Snapshot trace support for flow tests.

## Test packages

```text
@tripley-kit/web-container-testing
@tripley-kit/web-container-testing-native
@tripley-kit/web-container-testing-flow
@tripley-kit/web-container-testing-plugin
@tripley-kit/web-container-testing-device
```

## Mock Native SDK

```ts
const native = createMockNativePort({
  capabilities: ['runtime', 'fs', 'sqlite', 'window.openWindow', 'display.listDisplays'],
  displays: [{ id: 'front', bounds: { x: 0, y: 0, width: 1080, height: 1920 } }]
});
```

## Flow test runner

```ts
await expectFlow(kioskWithdrawalFlow)
  .withInput({ amount: 1000 })
  .mockCondition('cash.available', true)
  .mockCommand('withdrawal.amount.confirmed', { amount: 1000 })
  .mockEvent('host.withdrawal.approved', { approvalCode: 'OK' })
  .expectPath(['precheck', 'enterAmount', 'sendHostRequest', 'dispenseCash', 'complete'])
  .expectCompleted();
```

## User input adapter contract test

```ts
describeInputSourceAdapterContract('bank.idCardReader.identity', () => new IdCardReaderInputSourceAdapter(), {
  validSourceDefinition,
  expectedCancelOnExit: true,
  expectedSafeSummary: true
});
```

## Plugin contract test

Tests manifest validity, dependency resolution, declared contributions, activation, dispose, and undeclared permission warnings.

## Command/Condition tests

```ts
await expectCommand('kiosk.withdrawal.start')
  .withCondition('cash.available', false)
  .expectDisabled('cash.empty');
```

## Testing policy

All built-in adapters must have the same contract tests that project adapters are expected to pass.
