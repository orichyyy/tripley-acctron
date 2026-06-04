import type { CommandDef, QueryDef } from "./bus";
import type { FlowRunResult } from "./flow";

export type TransactionLifecycleState = "idle" | "running" | "completed" | "cancelled" | "failed";

export interface FlowRunOptions {
  signal?: AbortSignal;
}

export interface FlowRunner {
  run(flowId: string, options?: FlowRunOptions): Promise<FlowRunResult>;
}

export interface TransactionStartRequest {
  flowId: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionCancelRequest {
  reason?: string;
}

export interface TransactionResetRequest {
  metadata?: Record<string, unknown>;
}

export type TransactionStatusRequest = Record<never, never>;

export interface TransactionLifecycleStatus {
  state: TransactionLifecycleState;
  flowId?: string;
  result?: FlowRunResult;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

declare module "./bus" {
  interface KioskCommands {
    "transaction.start": CommandDef<TransactionStartRequest, TransactionLifecycleStatus>;
    "transaction.cancel": CommandDef<TransactionCancelRequest, TransactionLifecycleStatus>;
    "transaction.reset": CommandDef<TransactionResetRequest, TransactionLifecycleStatus>;
  }

  interface KioskQueries {
    "transaction.status": QueryDef<TransactionStatusRequest, TransactionLifecycleStatus>;
  }
}
