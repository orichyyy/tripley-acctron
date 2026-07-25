import type { CommandRegistry } from "@tripley-kit/web-container-command-system";
import type { KioskRuntime, KioskRuntimeMode } from "@tripley-kit/web-container-kiosk-runtime";
import type { StoreApi } from "zustand";

import type { WithdrawalDiagnosticsSource } from "./operator-diagnostics";

export interface ExampleDiagnostics {
  readonly bootstrapError?: string | undefined;
  readonly health?:
    | {
        readonly checkedAt: string;
        readonly checks: readonly { readonly id: string; readonly status: string }[];
      }
    | undefined;
  readonly hostdUrl?: string | undefined;
  readonly logicalServices: Readonly<Record<string, string>>;
  readonly withdrawal: WithdrawalDiagnosticsSource;
}

export interface ExampleApplicationRuntime {
  readonly mode: KioskRuntimeMode;
  readonly runtime: KioskRuntime;
  readonly commands: CommandRegistry;
  readonly store: StoreApi<Record<string, unknown>>;
  readonly operationStateKey: string;
  readonly diagnostics: ExampleDiagnostics;
  dispose(): Promise<void>;
  reboot(mode: KioskRuntimeMode): Promise<void>;
}
