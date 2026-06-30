import { CommandRegistry } from "@tripley/web-container-command-system";
import { ConditionRegistry } from "@tripley/web-container-condition-engine";
import type { InputSourceAdapter, UserInputSourceResult } from "@tripley/web-container-device-core";
import { InputSourceRegistry } from "@tripley/web-container-device-core";
import {
  type FlowDefinition,
  type FlowInstanceSnapshot,
  FlowNodeExecutorRegistry,
  FlowTestRunner,
  type UserInputNodeDefinition,
  defineFlow,
  defineNode,
  defineUserInputNode,
} from "@tripley/web-container-flow-engine";
import type { LoggerPort } from "@tripley/web-container-logging";
import { MemoryScopedStore } from "@tripley/web-container-scoped-store";
import { FrameworkUiPort, MemoryUiStateAdapter } from "@tripley/web-container-ui-port";

import { createKioskProjectBlueprint } from "./preset";
import {
  InMemoryAuditJournalRepository,
  InMemoryTransactionRepository,
  type TransactionRecord,
} from "./repositories";
import {
  AccessibilityService,
  AuditJournalService,
  DefaultBusinessCalendar,
  FeatureFlagService,
  HealthCheckCenter,
  InMemoryOperationLedger,
  PromptCatalog,
} from "./services";

export interface WithdrawalExampleProject {
  readonly blueprint: ReturnType<typeof createKioskProjectBlueprint>;
  readonly commandRegistry: CommandRegistry;
  readonly conditionRegistry: ConditionRegistry;
  readonly inputSources: InputSourceRegistry;
  readonly flow: FlowDefinition;
  readonly scenario: WithdrawalScenarioSummary;
  runCommand(): Promise<TransactionRecord>;
  runValidationFailure(): Promise<FlowInstanceSnapshot>;
  runSecurePin(): Promise<FlowInstanceSnapshot>;
}

export interface WithdrawalScenarioSummary {
  readonly commandId: string;
  readonly flowId: string;
  readonly dynamicUserInputNodeId: string;
  readonly optionalBarcodeQrInput: boolean;
  readonly validationFailureFeedbackKey: string;
  readonly securePinNodeId: string;
  readonly timeoutMs: number;
  readonly interruptId: string;
  readonly scopedStoreResetReason: string;
  readonly auditEventId: string;
  readonly loggingEventId: string;
  readonly extensionKind: string;
}

export const createWithdrawalExampleProject = (
  extensionAdapters: readonly InputSourceAdapter[] = [],
): WithdrawalExampleProject => {
  const transactionRepository = new InMemoryTransactionRepository();
  const auditRepository = new InMemoryAuditJournalRepository();
  const audit = new AuditJournalService(auditRepository);
  const operationLedger = new InMemoryOperationLedger();
  const scopedStore = new MemoryScopedStore();
  const ui = new FrameworkUiPort({ navigate: () => {} }, new MemoryUiStateAdapter());
  const inputSources = new InputSourceRegistry();
  const conditionRegistry = new ConditionRegistry();
  const commandRegistry = new CommandRegistry();
  const flow = createWithdrawalExampleFlow();
  const logger = createMemoryLogger();

  for (const adapter of [
    createDemoInputAdapter(),
    createDemoQrAdapter(),
    createDemoSecurePinAdapter(),
    ...extensionAdapters,
  ]) {
    inputSources.register(adapter);
  }

  conditionRegistry.register({
    evaluate: () => true,
    id: "features.withdrawal.enabled",
  });
  conditionRegistry.register({
    evaluate: async () => ({ allowed: true }),
    id: "device.cashUnit.ready",
  });

  commandRegistry.register({
    canExecute: async (ctx) => {
      if (!ctx.conditions) {
        return { allowed: false, reasonCode: "conditions.missing" };
      }

      return ctx.conditions.evaluate("features.withdrawal.enabled", ctx);
    },
    execute: async () => {
      const transaction = await transactionRepository.create({
        amount: 100,
        businessType: "withdrawal",
        currency: "USD",
        id: "txn-withdrawal-demo",
        metadata: { example: true },
        traceId: "trace-withdrawal-demo",
      });
      await operationLedger.start("host.withdrawal", `withdrawal:${transaction.id}`);
      await audit.append({
        businessType: "withdrawal",
        eventId: "customer.selected.withdrawal",
        message: "Customer selected withdrawal",
        traceId: transaction.traceId,
        transactionId: transaction.id,
      });
      await scopedStore.resetTransaction("withdrawal.flow.finally");
      return transaction;
    },
    id: "kiosk.withdrawal.start",
    options: {
      disableWhileRunning: true,
      idempotencyKey: (input) => `withdrawal:${JSON.stringify(input)}`,
      showLoadingWhileRunning: true,
      tts: { mode: "interrupt", text: "You selected withdrawal" },
    },
  });

  const runner = new FlowTestRunner({
    inputSources,
    nodeExecutors: new FlowNodeExecutorRegistry(),
  });

  return {
    blueprint: createKioskProjectBlueprint(),
    commandRegistry,
    conditionRegistry,
    flow,
    inputSources,
    scenario: {
      auditEventId: "customer.selected.withdrawal",
      commandId: "kiosk.withdrawal.start",
      dynamicUserInputNodeId: "enterAmount",
      extensionKind: "bank.demoPalmScanner.identity",
      flowId: flow.id,
      interruptId: "card.removed",
      loggingEventId: "flow.userInput.captured",
      optionalBarcodeQrInput: true,
      scopedStoreResetReason: "withdrawal.flow.finally",
      securePinNodeId: "enterPin",
      timeoutMs: 30_000,
      validationFailureFeedbackKey: "withdrawal.amount.invalid",
    },
    runCommand: () =>
      commandRegistry.execute(
        "kiosk.withdrawal.start",
        { conditions: conditionRegistry, logger, ui },
        { amount: 100 },
      ),
    runSecurePin: () =>
      runner.run(flow, { accountType: "checking", demoValue: "1234" }, { logger, scopedStore }),
    runValidationFailure: () =>
      runner.run(flow, { accountType: "checking", demoValue: "0" }, { logger, scopedStore }),
  };
};

export const createWithdrawalExampleFlow = (): FlowDefinition =>
  defineFlow({
    id: "kiosk.withdrawal.example",
    nodes: {
      enterAmount: createEnterAmountNode(),
      enterPin: createEnterPinNode(),
      returnToIdle: defineNode({
        id: "returnToIdle",
        kind: "terminal",
      }),
      submitWithdrawal: defineNode({
        id: "submitWithdrawal",
        kind: "terminal",
      }),
    },
    policies: {
      interrupts: [
        {
          action: { reasonCode: "CARD.REMOVED", type: "cancelFlow" },
          eventTopic: "device.card.removed",
          id: "card.removed",
          priority: 100,
        },
      ],
      userInputTimeout: {
        onTimeout: { nodeId: "returnToIdle", type: "next" },
        timeoutMs: 30_000,
      },
    },
    startNodeId: "enterAmount",
    trace: { redactSecureInput: true, summaryOnly: true },
    version: "1.0.0",
  });

const createEnterAmountNode = (): UserInputNodeDefinition =>
  defineUserInputNode({
    id: "enterAmount",
    input: {
      profile: (ctx) => {
        const input = ctx.input as { accountType?: string };
        return {
          constraints:
            input.accountType === "checking"
              ? { maxLength: 4, minLength: 2 }
              : { maxLength: 6, minLength: 1 },
          errorMessageKeys: {
            minLength: "withdrawal.amount.invalid",
          },
          id: `withdrawal.amount.${input.accountType ?? "default"}`,
          promptKey: "withdrawal.amount.prompt",
          sourceOptions: {
            "barcodeReader.qr": { parseAs: "withdrawalQr" },
            "demo.input": { dataType: "numeric" },
          },
        };
      },
      sources: (profile, ctx) => [
        {
          id: "pinpadAmount",
          kind: "demo.input",
          options: {
            demoValue: (ctx.input as { demoValue?: string }).demoValue ?? "100",
            maxLength: profile.constraints?.maxLength,
            minLength: profile.constraints?.minLength,
          },
          required: true,
        },
        {
          enabledWhen: "features.withdrawal.qrInput.enabled",
          id: "mobileQr",
          kind: "barcodeReader.qr",
          required: false,
        },
      ],
      ui: { path: "/customer/withdrawal/amount", stateKey: "withdrawal.amount" },
      validation: {
        local: (result) => {
          const value = Number(result.value);
          return value > 0
            ? { valid: true, value }
            : {
                messageKey: "withdrawal.amount.invalid",
                reasonCode: "AMOUNT.INVALID",
                valid: false,
              };
        },
      },
    },
    kind: "userInput",
    next: "enterPin",
  });

const createEnterPinNode = (): UserInputNodeDefinition =>
  defineUserInputNode({
    id: "enterPin",
    input: {
      profile: {
        constraints: { maxLength: 12, minLength: 4 },
        id: "pin.secure",
        promptKey: "withdrawal.pin.prompt",
      },
      security: "secure",
      sources: [
        {
          id: "pinpadPin",
          kind: "pinpad.pin",
          required: true,
          secure: true,
        },
      ],
      trace: { safeToLog: false, summaryOnly: true },
      ui: { path: "/customer/withdrawal/pin", stateKey: "withdrawal.pin" },
    },
    kind: "userInput",
  });

const createDemoInputAdapter = (): InputSourceAdapter => ({
  canStart: () => true,
  kind: "demo.input",
  start: async (_ctx, source) => ({
    cancel: async () => {},
    id: `session.${source.id}`,
    result: Promise.resolve({
      kind: "plain",
      safeSummary: { sourceKind: source.kind },
      source: { id: source.id, kind: source.kind },
      value: (source.options as { demoValue?: string } | undefined)?.demoValue ?? "100",
    }),
    sourceId: source.id,
    sourceKind: source.kind,
  }),
});

const createDemoQrAdapter = (): InputSourceAdapter => ({
  canStart: () => true,
  kind: "barcodeReader.qr",
  start: async (_ctx, source) => ({
    cancel: async () => {},
    id: `session.${source.id}`,
    result: new Promise<UserInputSourceResult>(() => {}),
    sourceId: source.id,
    sourceKind: source.kind,
  }),
});

const createDemoSecurePinAdapter = (): InputSourceAdapter => ({
  canStart: () => true,
  kind: "pinpad.pin",
  start: async (_ctx, source) => ({
    cancel: async () => {},
    id: `session.${source.id}`,
    result: Promise.resolve({
      encryptedPinBlock: "not-logged-demo-pin-block",
      kind: "securePin",
      safeSummary: {
        hasEncryptedPinBlock: true,
        sourceKind: "pinpad.pin",
      },
      source: { id: source.id, kind: "pinpad.pin" },
    } as UserInputSourceResult),
    sourceId: source.id,
    sourceKind: source.kind,
  }),
});

export const createProjectSpecificInputExtension = (): InputSourceAdapter => ({
  canStart: () => true,
  kind: "bank.demoPalmScanner.identity",
  start: async (_ctx, source) => ({
    cancel: async () => {},
    id: `session.${source.id}`,
    result: Promise.resolve({
      kind: "identity",
      safeSummary: { sourceKind: source.kind },
      source: { id: source.id, kind: source.kind },
      value: "demo-customer",
    }),
    sourceId: source.id,
    sourceKind: source.kind,
  }),
});

export const createDefaultKioskServices = () => ({
  accessibility: new AccessibilityService(),
  businessCalendar: new DefaultBusinessCalendar(),
  featureFlags: new FeatureFlagService([
    { enabled: true, id: "features.withdrawal.enabled" },
    { enabled: true, id: "features.withdrawal.qrInput.enabled" },
  ]),
  health: new HealthCheckCenter(),
  operationLedger: new InMemoryOperationLedger(),
  promptCatalog: new PromptCatalog([
    {
      key: "withdrawal.amount.prompt",
      locale: "en",
      text: "Enter withdrawal amount",
    },
    {
      key: "withdrawal.pin.prompt",
      locale: "en",
      text: "Enter your PIN",
    },
    {
      key: "withdrawal.amount.invalid",
      locale: "en",
      text: "Enter an amount greater than zero",
    },
  ]),
});

const createMemoryLogger = (): LoggerPort => ({
  child: () => createMemoryLogger(),
  debug: () => {},
  error: () => {},
  info: () => {},
  trace: () => {},
  warn: () => {},
});
