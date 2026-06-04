import { useEffect, useMemo, useState } from "react";
import { useUiRuntime } from "@tripley-acctron/react-ui";
import type { UiRuntimeSnapshot } from "@tripley-acctron/react-ui";
import type { TransactionLifecycleStatus } from "@tripley-acctron/contracts";
import { createDemoKioskRuntime, type DemoKioskRuntime } from "./demo-runtime";
import type { HostScenario } from "./screens";

export interface DemoRuntimeViewModel {
  runtime: DemoKioskRuntime;
  snapshot: UiRuntimeSnapshot;
  status: TransactionLifecycleStatus;
  running: boolean;
  error: string | undefined;
  start(scenario: HostScenario): void;
  reset(scenario: HostScenario): void;
}

export function useDemoRuntime(): DemoRuntimeViewModel {
  const runtime = useMemo(() => createDemoKioskRuntime(), []);
  const [status, setStatus] = useState<TransactionLifecycleStatus>({ state: "idle" });
  const [error, setError] = useState<string | undefined>();
  const snapshot = useUiRuntime(runtime.store);

  useEffect(() => {
    void executeReset(runtime, "approved", setStatus, setError);
  }, [runtime]);

  return {
    runtime,
    snapshot,
    status,
    running: status.state === "running",
    error,
    start(scenario) {
      setError(undefined);
      setStatus({ state: "running", flowId: "atm-basic", metadata: { scenario } });
      void runtime.commands
        .execute("transaction.start", { flowId: "atm-basic", metadata: { scenario } })
        .then(setStatus)
        .catch((runError: unknown) => setError(errorMessage(runError)));
    },
    reset(scenario) {
      setError(undefined);
      void executeReset(runtime, scenario, setStatus, setError);
    },
  };
}

function executeReset(
  runtime: DemoKioskRuntime,
  scenario: HostScenario,
  setStatus: (status: TransactionLifecycleStatus) => void,
  setError: (error: string | undefined) => void,
): Promise<void> {
  return runtime.commands
    .execute("transaction.reset", { metadata: { scenario } })
    .then(setStatus)
    .catch((resetError: unknown) => {
      setError(errorMessage(resetError));
    });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
