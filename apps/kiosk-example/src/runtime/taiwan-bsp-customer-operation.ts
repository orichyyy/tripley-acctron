import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { CredentialAssessment } from "@tripley-kit/web-container-kiosk-runtime";
import type { WithdrawalExecutionResult } from "@tripley-kit/web-container-withdrawal-orchestration";

import type { BspV243IwdContext } from "../../script/bsp-v243/withdrawal-contracts";
import type { ExampleWithdrawalBusiness } from "./operation-business";
import {
  SensitiveOperationMaterialVault,
  type OperationMaterialSnapshot,
} from "./operation-material";
import type { TaiwanBspWithdrawalInput } from "./taiwan-bsp-withdrawal";

export interface TaiwanBspOperationContextAssembly {
  readonly bspContext: BspV243IwdContext;
  readonly cardAuthority?: TaiwanBspWithdrawalInput["cardAuthority"];
  readonly entryMode: TaiwanBspWithdrawalInput["entryMode"];
  readonly safeMetadata?: TaiwanBspWithdrawalInput["safeMetadata"];
}

export interface TaiwanBspOperationContextAssembler {
  assemble(input: {
    readonly amount: number;
    readonly assessment: CredentialAssessment;
    readonly material: OperationMaterialSnapshot;
    readonly operationId: string;
  }): Promise<TaiwanBspOperationContextAssembly>;
}

export interface TaiwanBspWithdrawalApplicationPort {
  execute(input: TaiwanBspWithdrawalInput): Promise<WithdrawalExecutionResult>;
}

export interface TaiwanBspCustomerOperationOptions {
  readonly application: TaiwanBspWithdrawalApplicationPort;
  readonly assembler: TaiwanBspOperationContextAssembler;
  readonly currency: string;
  readonly materials?: SensitiveOperationMaterialVault | undefined;
  readonly minorUnitFactor: number;
}

export const createTaiwanBspCustomerOperation = (
  options: TaiwanBspCustomerOperationOptions,
): ExampleWithdrawalBusiness => {
  assertAmountPolicy(options.currency, options.minorUnitFactor);
  const materials = options.materials ?? new SensitiveOperationMaterialVault();
  return {
    operationMaterial: materials,
    execute: async ({ amount, assessment, context }) => {
      try {
        const assembly = await options.assembler.assemble({
          amount,
          assessment,
          material: materials.require(context.operationId),
          operationId: context.operationId,
        });
        const result = await options.application.execute({
          amount: {
            currency: options.currency,
            minorUnits: toMinorUnits(amount, options.minorUnitFactor),
          },
          bspContext: assembly.bspContext,
          ...(assembly.cardAuthority ? { cardAuthority: assembly.cardAuthority } : {}),
          entryMode: assembly.entryMode,
          operationId: context.operationId,
          ...(assembly.safeMetadata ? { safeMetadata: assembly.safeMetadata } : {}),
          signal: context.signal,
        });
        await projectMediaCustody(context, result);
        if (result.outcome.status !== "completed") {
          throw withdrawalFailure(result);
        }
        return {
          ...result.outcome.safeSummary,
          cardStatus: result.outcome.card.status,
          cashCustody: result.outcome.cash.custody,
          hostStatus: result.outcome.host.status,
          reason: result.outcome.reason,
          status: result.outcome.status,
        };
      } finally {
        materials.clear(context.operationId);
      }
    },
    onOperationExit: ({ operationId }) => materials.clear(operationId),
  };
};

const projectMediaCustody = async (
  context: Parameters<ExampleWithdrawalBusiness["execute"]>[0]["context"],
  result: WithdrawalExecutionResult,
): Promise<void> => {
  switch (result.outcome.card.status) {
    case "returned":
      await context.setMediaCustody("returned");
      return;
    case "retained":
      await context.setMediaCustody("retained");
      return;
    case "intervention":
      await context.setMediaCustody("unknown");
      return;
  }
};

const withdrawalFailure = (result: WithdrawalExecutionResult): FrameworkError =>
  new FrameworkError({
    category: "dependency",
    code: `withdrawal.${result.outcome.reason}`,
    message: "Withdrawal business execution did not complete.",
    metadata: {
      cardStatus: result.outcome.card.status,
      cashCustody: result.outcome.cash.custody,
      hostStatus: result.outcome.host.status,
      operationId: result.outcome.operationId,
      status: result.outcome.status,
    },
  });

const assertAmountPolicy = (currency: string, minorUnitFactor: number): void => {
  if (!currency.trim()) {
    throw new Error("taiwan.bsp.amount.currency-required");
  }
  if (!Number.isSafeInteger(minorUnitFactor) || minorUnitFactor <= 0) {
    throw new Error("taiwan.bsp.amount.minor-unit-factor-invalid");
  }
};

const toMinorUnits = (amount: number, factor: number): number => {
  const minorUnits = amount * factor;
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) {
    throw new Error("taiwan.bsp.amount.minor-units-invalid");
  }
  return minorUnits;
};
