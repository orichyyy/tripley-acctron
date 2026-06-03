import type { Disposable } from "./bus";

export type RecoveryReason =
  | "normalEnd"
  | "cancel"
  | "timeout"
  | "unhandledError"
  | "deviceFailure";

export interface TransactionResource {
  onNormalEnd?: () => Promise<void>;
  onCancel?: () => Promise<void>;
  onTimeout?: () => Promise<void>;
  onError?: () => Promise<void>;
  onDeviceFailure?: () => Promise<void>;
}

export interface TransactionResourceRegistry {
  register(name: string, resource: TransactionResource): Disposable;
  recover(reason: RecoveryReason): Promise<void>;
  clear(): Promise<void>;
}

export interface RecoveryOptions {
  reason: RecoveryReason;
  error?: unknown;
}

export interface RecoveryManager {
  recover(options: RecoveryOptions): Promise<void>;
}
