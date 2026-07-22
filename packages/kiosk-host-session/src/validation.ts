import type { HostSessionSupervisorOptions } from "./contracts";

export const validateHostSessionOptions = (options: HostSessionSupervisorOptions): void => {
  if (!options.id) throw new Error("host.session-supervisor.id-required");
  positive(options.policy.establishTimeoutMs, "establish-timeout-invalid");
  positive(options.policy.establishRetry.initialDelayMs, "retry-delay-invalid");
  positive(options.policy.establishRetry.maxDelayMs, "retry-max-delay-invalid");
  if (options.policy.establishRetry.multiplier < 1) {
    throw new Error("host.session-supervisor.retry-multiplier-invalid");
  }
  if (options.policy.establishRetry.maxDelayMs < options.policy.establishRetry.initialDelayMs) {
    throw new Error("host.session-supervisor.retry-range-invalid");
  }
  const heartbeat = options.policy.heartbeat;
  if (!heartbeat) return;
  if (!options.protocol.heartbeat)
    throw new Error("host.session-supervisor.heartbeat-hook-required");
  positive(heartbeat.intervalMs, "heartbeat-interval-invalid");
  positive(heartbeat.timeoutMs, "heartbeat-timeout-invalid");
  positive(heartbeat.failureThreshold, "heartbeat-threshold-invalid");
};

const positive = (value: number, code: string): void => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`host.session-supervisor.${code}`);
};
