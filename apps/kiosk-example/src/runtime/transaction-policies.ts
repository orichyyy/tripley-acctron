import {
  DepositEscrowReviewGateRegistry,
  DepositPolicyRegistry,
  type DepositEscrowReviewGate,
} from "@tripley-kit/web-container-deposit-orchestration";
import {
  WithdrawalPolicyRegistry,
  WithdrawalPrePresentGateRegistry,
  type WithdrawalPrePresentGate,
} from "@tripley-kit/web-container-withdrawal-orchestration";

export interface ExampleWithdrawalPolicyOptions {
  readonly cardOrder?: "return-before-cash-present" | "return-after-cash-terminal";
  readonly cashPlanningOrder?:
    | "authorization-before-cash-planning"
    | "cash-planning-before-authorization";
  readonly hostFinancialCompletion?: boolean;
  readonly mobileOtpGate?: WithdrawalPrePresentGate | undefined;
}

export const createExampleWithdrawalPolicy = (
  options: ExampleWithdrawalPolicyOptions = {},
) => {
  const gates = new WithdrawalPrePresentGateRegistry();
  if (options.mobileOtpGate) gates.register(options.mobileOtpGate);
  const policies = new WithdrawalPolicyRegistry().register({
    allowedEntryModes: ["contact-card", "cardless-reservation"],
    cardCustodyPolicyId: "card.standard",
    cardOrder: options.cardOrder ?? "return-before-cash-present",
    cashPlanningOrder:
      options.cashPlanningOrder ?? "authorization-before-cash-planning",
    hostProtocol: {
      id: "acctron.withdrawal.host",
      mode: options.hostFinancialCompletion
        ? "authorization-then-completion"
        : "authorization-only",
      version: "1",
    },
    id: "acctron.withdrawal.standard",
    prePresentGateIds: options.mobileOtpGate ? [options.mobileOtpGate.id] : [],
    presentationPolicy: {
      authorizationTtlMs: 10_000,
      id: "acctron.cash.present",
      requiredGates: [],
      takeTimeoutMs: 30_000,
      version: "1",
    },
    version: "1",
  });
  return { gates, policies };
};

export interface ExampleDepositPolicyOptions {
  readonly hostFinancialCompletion?: boolean;
  readonly logicalService: string;
  readonly resourceGroup: string;
  readonly reviewGate: DepositEscrowReviewGate;
}

export const createExampleDepositPolicy = (options: ExampleDepositPolicyOptions) => {
  const reviewGates = new DepositEscrowReviewGateRegistry().register(options.reviewGate);
  const policies = new DepositPolicyRegistry().register({
    acceptancePolicy: {
      acceptTimeoutMs: 30_000,
      inputPosition: 4,
      notTakenAction: "retract",
      outputPosition: 512,
      retractTimeoutMs: 10_000,
      startTimeoutMs: 10_000,
      takeTimeoutMs: 30_000,
    },
    hostProtocol: {
      id: "acctron.deposit.host",
      mode: options.hostFinancialCompletion
        ? "authorization-then-completion"
        : "authorization-only",
      version: "1",
    },
    id: "acctron.deposit.standard",
    logicalService: options.logicalService,
    maxBatches: 3,
    resourceGroup: options.resourceGroup,
    reviewGateId: options.reviewGate.id,
    version: "1",
  });
  return { policies, reviewGates };
};
