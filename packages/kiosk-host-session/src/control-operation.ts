import type {
  HostSessionControlContext,
  HostSessionControlResult,
  HostSessionScheduledTask,
  HostSessionScheduler,
} from "./contracts";

export interface ControlOperationHandle {
  readonly signal: AbortSignal;
  readonly result: Promise<HostSessionControlResult>;
  cancel(): void;
}

export const startControlOperation = (
  scheduler: HostSessionScheduler,
  timeoutMs: number,
  context: Omit<HostSessionControlContext, "signal">,
  hook: (context: HostSessionControlContext) => Promise<HostSessionControlResult>,
): ControlOperationHandle => {
  const controller = new AbortController();
  let timer: HostSessionScheduledTask | undefined;
  let settle: ((result: HostSessionControlResult) => void) | undefined;
  const result = new Promise<HostSessionControlResult>((resolve) => {
    let settled = false;
    settle = (outcome) => {
      if (settled) return;
      settled = true;
      timer?.cancel();
      resolve(outcome);
    };
    controller.signal.addEventListener(
      "abort",
      () => settle?.({ status: "failed", errorCode: "host.session-supervisor.control-cancelled" }),
      { once: true },
    );
    timer = scheduler.schedule(timeoutMs, () => {
      settle?.({ status: "failed", errorCode: "host.session-supervisor.control-timeout" });
      controller.abort();
    });
    Promise.resolve()
      .then(() => hook({ ...context, signal: controller.signal }))
      .then((outcome) => settle?.(normalizeControlResult(outcome)))
      .catch(() =>
        settle?.({ status: "failed", errorCode: "host.session-supervisor.control-hook-failed" }),
      );
  });
  return { cancel: () => controller.abort(), result, signal: controller.signal };
};

const normalizeControlResult = (result: HostSessionControlResult): HostSessionControlResult => {
  if (result?.status === "accepted") return result;
  if (result?.status === "failed" && result.errorCode) return result;
  return { status: "failed", errorCode: "host.session-supervisor.control-result-invalid" };
};
