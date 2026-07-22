import type { Condition, ConditionRegistry } from "@tripley-kit/web-container-condition-engine";
import type { HealthCheck } from "@tripley-kit/web-container-kiosk-base";

import type { HostSessionSupervisorPort } from "./contracts";

export const createHostSessionReadyCondition = (
  supervisor: HostSessionSupervisorPort,
  id = `host.session.${supervisor.id}.ready`,
): Condition => ({
  id,
  evaluate: () => {
    const snapshot = supervisor.snapshot;
    return snapshot.available
      ? { allowed: true }
      : {
          allowed: false,
          data: { generation: snapshot.generation, state: snapshot.state },
          reasonCode: snapshot.reasonCode ?? "host.session.not-ready",
        };
  },
});

export const registerHostSessionReadyCondition = (
  registry: ConditionRegistry,
  supervisor: HostSessionSupervisorPort,
  id?: string,
): string => {
  const condition = createHostSessionReadyCondition(supervisor, id);
  registry.register(condition);
  return condition.id;
};

export const createHostSessionHealthCheck = (
  supervisor: HostSessionSupervisorPort,
  id = `host.session.${supervisor.id}`,
): HealthCheck => ({
  id,
  async run() {
    const snapshot = supervisor.snapshot;
    const status = snapshot.available
      ? "pass"
      : snapshot.state === "establishing" || snapshot.state === "connecting"
        ? "warn"
        : "fail";
    return {
      data: {
        generation: snapshot.generation,
        heartbeatFailures: snapshot.consecutiveHeartbeatFailures,
        state: snapshot.state,
      },
      id,
      message: snapshot.reasonCode,
      status,
    };
  },
});
