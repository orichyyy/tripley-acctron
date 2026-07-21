import type {
  DepositReason,
  DepositRequest,
  DepositStatus,
  DepositTrigger,
} from "./contracts";

export const requestTimeout = (request: DepositRequest): boolean => {
  const reason = request.signal?.reason;
  return typeof reason === "string" && /timeout/i.test(reason);
};

export const reviewFailure = (
  decision: "accept-more" | "cancelled" | "timedOut" | "rejected",
  atLimit: boolean,
): {
  abortReason: "cancelled" | "timeout";
  reason: DepositReason;
  status: DepositStatus;
  trigger: DepositTrigger;
} => {
  if (decision === "timedOut") {
    return {
      abortReason: "timeout",
      reason: "customer-timeout",
      status: "timedOut",
      trigger: "timeout",
    };
  }
  if (decision === "cancelled") {
    return {
      abortReason: "cancelled",
      reason: "customer-cancelled",
      status: "cancelled",
      trigger: "cancel",
    };
  }
  if (decision === "accept-more" && atLimit) {
    return {
      abortReason: "cancelled",
      reason: "batch-limit-reached",
      status: "failed",
      trigger: "interrupt",
    };
  }
  return {
    abortReason: "cancelled",
    reason: "review-rejected",
    status: "failed",
    trigger: "interrupt",
  };
};
