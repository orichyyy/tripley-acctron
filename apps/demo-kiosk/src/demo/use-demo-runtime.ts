import { useEffect, useMemo, useState } from "react";
import { useUiRuntime } from "@tripley-acctron/react-ui";
import type { UiRuntimeSnapshot } from "@tripley-acctron/react-ui";
import { createDemoKioskRuntime, type DemoKioskRuntime } from "./demo-runtime";
import type { HostScenario } from "./screens";

export interface DemoRuntimeViewModel {
  runtime: DemoKioskRuntime;
  snapshot: UiRuntimeSnapshot;
  running: boolean;
  error: string | undefined;
  start(scenario: HostScenario): void;
  reset(scenario: HostScenario): void;
}

export function useDemoRuntime(): DemoRuntimeViewModel {
  const runtime = useMemo(() => createDemoKioskRuntime(), []);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const snapshot = useUiRuntime(runtime.store);

  useEffect(() => {
    void runtime.reset("approved").catch((resetError: unknown) => {
      setError(errorMessage(resetError));
    });
  }, [runtime]);

  return {
    runtime,
    snapshot,
    running,
    error,
    start(scenario) {
      setRunning(true);
      setError(undefined);
      void runtime
        .start(scenario)
        .catch((runError: unknown) => {
          setError(errorMessage(runError));
        })
        .finally(() => {
          setRunning(false);
        });
    },
    reset(scenario) {
      setRunning(false);
      setError(undefined);
      void runtime.reset(scenario).catch((resetError: unknown) => {
        setError(errorMessage(resetError));
      });
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
