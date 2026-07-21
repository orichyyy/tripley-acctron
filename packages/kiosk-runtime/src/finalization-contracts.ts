export type FinalizationStepStatus = "pending" | "running" | "completed" | "failed";

export interface OperationFinalizationContext {
  readonly operationId: string;
  readonly flowId?: string | undefined;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface OperationFinalizationRecoveryContext {
  readonly operationId: string;
  readonly flowId?: string | undefined;
  readonly result?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface OperationFinalizationContextProjector {
  project(context: OperationFinalizationContext): OperationFinalizationRecoveryContext;
}

export interface OperationFinalizer {
  readonly id: string;
  readonly version: string;
  readonly after?: readonly string[] | undefined;
  execute(context: OperationFinalizationContext): Promise<void>;
}

export interface FrozenFinalizationStep {
  readonly id: string;
  readonly version: string;
  readonly status: FinalizationStepStatus;
  readonly attempts: number;
  readonly lastError?: string | undefined;
}

export interface OperationFinalizationRecord {
  readonly operationId: string;
  readonly planVersion: string;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly steps: readonly FrozenFinalizationStep[];
  readonly recoveryContext?: OperationFinalizationRecoveryContext | undefined;
  readonly updatedAt: string;
}

export interface OperationFinalizationStore {
  load(operationId: string): Promise<OperationFinalizationRecord | undefined>;
  save(record: OperationFinalizationRecord): Promise<void>;
  listIncomplete(): Promise<readonly OperationFinalizationRecord[]>;
}
