import { MemoryScopedStore, type ScopedStore } from "@tripley-kit/web-container-scoped-store";
import {
  CashPresentationAuthorizer,
  CashPresentationGateRegistry,
} from "@tripley-kit/web-container-xfs-device-service";
import {
  WithdrawalPolicyRegistry,
  WithdrawalPrePresentGateRegistry,
  type WithdrawalCardCustodyPort,
  type WithdrawalCashDeliveryPort,
  type WithdrawalExecutionResult,
  type WithdrawalHostPostingPort,
  type WithdrawalPrePresentGate,
  type WithdrawalPresentationAuthorizerPort,
  type WithdrawalRecoveryBarrierPort,
  type WithdrawalRequest,
} from "@tripley-kit/web-container-withdrawal-orchestration";

import type { BspV243IwdContext } from "../../script/bsp-v243/withdrawal-contracts";
import {
  createExampleDurableTransactions,
  type ExampleDurableTransactionOptions,
} from "./durable-transactions";
import { TaiwanBspWithdrawalContextVault } from "./taiwan-bsp-withdrawal-context";

export const TAIWAN_BSP_WITHDRAWAL_POLICY_ID = "taiwan.bsp.v243.withdrawal";

export interface TaiwanBspWithdrawalApplicationOptions {
  readonly db: ExampleDurableTransactionOptions["db"];
  readonly protection: ExampleDurableTransactionOptions["protection"];
  readonly host: WithdrawalHostPostingPort;
  readonly cash: WithdrawalCashDeliveryPort;
  readonly card?: WithdrawalCardCustodyPort | undefined;
  readonly recoveryBarrier?: WithdrawalRecoveryBarrierPort | undefined;
  readonly presentationAuthorizer?: WithdrawalPresentationAuthorizerPort | undefined;
  readonly prePresentGates?: readonly WithdrawalPrePresentGate[] | undefined;
  readonly cardOrder?: "return-before-cash-present" | "return-after-cash-terminal";
  readonly hostFinancialCompletion?: boolean | undefined;
  readonly ownerInstanceId: string;
  readonly scopedStore?: ScopedStore | undefined;
  readonly vault: TaiwanBspWithdrawalContextVault;
}

export interface TaiwanBspWithdrawalInput {
  readonly operationId: string;
  readonly entryMode: "contact-card" | "cardless-reservation";
  readonly amount: { readonly currency: string; readonly minorUnits: number };
  readonly bspContext: BspV243IwdContext;
  readonly cardAuthority?: WithdrawalRequest["cardAuthority"];
  readonly signal?: AbortSignal | undefined;
  readonly safeMetadata?: WithdrawalRequest["safeMetadata"];
}

export const createTaiwanBspWithdrawalApplication = async (
  options: TaiwanBspWithdrawalApplicationOptions,
) => {
  if (options.hostFinancialCompletion && !options.host.complete) {
    throw new Error("taiwan.bsp.host-financial-completion.missing");
  }
  const scopedStore = options.scopedStore ?? new MemoryScopedStore();
  const prePresentGates = new WithdrawalPrePresentGateRegistry();
  for (const gate of options.prePresentGates ?? []) prePresentGates.register(gate);
  const policies = new WithdrawalPolicyRegistry().register({
    allowedEntryModes: ["contact-card", "cardless-reservation"],
    cardCustodyPolicyId: "card.standard",
    cardOrder: options.cardOrder ?? "return-before-cash-present",
    cashPlanningOrder: "authorization-before-cash-planning",
    hostProtocol: {
      id: "taiwan.bsp",
      mode: options.hostFinancialCompletion
        ? "authorization-then-completion"
        : "authorization-only",
      version: "2.43",
    },
    id: TAIWAN_BSP_WITHDRAWAL_POLICY_ID,
    prePresentGateIds: (options.prePresentGates ?? []).map(({ id }) => id),
    presentationPolicy: {
      authorizationTtlMs: 10_000,
      id: "taiwan.bsp.cash.present",
      requiredGates: [],
      takeTimeoutMs: 30_000,
      version: "1",
    },
    version: "1",
  });
  const runtime = await createExampleDurableTransactions({
    db: options.db,
    protection: options.protection,
    withdrawal: {
      ...(options.card ? { card: options.card } : {}),
      cash: options.cash,
      host: options.host,
      hostFinancialCompletion: options.hostFinancialCompletion,
      policies,
      prePresentGates,
      presentationAuthorizer:
        options.presentationAuthorizer ??
        new CashPresentationAuthorizer(new CashPresentationGateRegistry()),
      recoveryBarrier: options.recoveryBarrier,
      scopedState: {
        reset: (operationId, reason) =>
          scopedStore.clearScope("transaction", operationId, reason),
      },
    },
  });
  if (!runtime.withdrawal) throw new Error("taiwan.bsp.withdrawal-runtime.missing");

  return {
    runtime,
    scopedStore,
    execute: async (
      input: TaiwanBspWithdrawalInput,
    ): Promise<WithdrawalExecutionResult> => {
      options.vault.bind(input.operationId, input.bspContext);
      scopedStore.scope("transaction", input.operationId).set("withdrawal.request", {
        currency: input.amount.currency,
        entryMode: input.entryMode,
        minorUnits: input.amount.minorUnits,
        policyId: TAIWAN_BSP_WITHDRAWAL_POLICY_ID,
      });
      try {
        return await runtime.withdrawal!.execute({
          amount: input.amount,
          ...(input.cardAuthority ? { cardAuthority: input.cardAuthority } : {}),
          entryMode: input.entryMode,
          operationId: input.operationId,
          ownerInstanceId: options.ownerInstanceId,
          policyId: TAIWAN_BSP_WITHDRAWAL_POLICY_ID,
          ...(input.safeMetadata ? { safeMetadata: input.safeMetadata } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } finally {
        options.vault.clear(input.operationId);
      }
    },
    dispose: () => runtime.dispose(),
  };
};
