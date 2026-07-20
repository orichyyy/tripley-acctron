import { CommandRegistry } from "@tripley-kit/web-container-command-system";
import { ConditionRegistry } from "@tripley-kit/web-container-condition-engine";
import type { InputSourceAdapter } from "@tripley-kit/web-container-device-core";
import { InputSourceRegistry } from "@tripley-kit/web-container-device-core";
import { FlowNodeExecutorRegistry, FlowTestRunner } from "@tripley-kit/web-container-flow-engine";
import type { LoggerPort } from "@tripley-kit/web-container-logging";
import { MemoryScopedStore } from "@tripley-kit/web-container-scoped-store";
import { FrameworkUiPort, MemoryUiStateAdapter } from "@tripley-kit/web-container-ui-port";

import { createKioskProjectBlueprint } from "../preset";
import { InMemoryAuditJournalRepository, InMemoryTransactionRepository } from "../repositories";
import { AuditJournalService, InMemoryOperationLedger } from "../services";
import {
  createDemoInputAdapter,
  createDemoQrAdapter,
  createDemoSecurePinAdapter,
} from "./adapters";
import type { WithdrawalExampleProject } from "./contracts";
import { createWithdrawalExampleFlow } from "./flow";

export const createWithdrawalExampleProject = (
  extensionAdapters: readonly InputSourceAdapter[] = [],
): WithdrawalExampleProject => {
  const transactionRepository = new InMemoryTransactionRepository();
  const audit = new AuditJournalService(new InMemoryAuditJournalRepository());
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

  conditionRegistry.register({ evaluate: () => true, id: "features.withdrawal.enabled" });
  conditionRegistry.register({
    evaluate: async () => ({ allowed: true }),
    id: "device.cashUnit.ready",
  });

  commandRegistry.register({
    canExecute: async (ctx) =>
      ctx.conditions
        ? ctx.conditions.evaluate("features.withdrawal.enabled", ctx)
        : { allowed: false, reasonCode: "conditions.missing" },
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

const createMemoryLogger = (): LoggerPort => ({
  child: () => createMemoryLogger(),
  debug: () => {},
  error: () => {},
  info: () => {},
  trace: () => {},
  warn: () => {},
});
