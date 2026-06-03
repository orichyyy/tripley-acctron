export type ServiceAvailability = "in-service" | "out-of-service" | "maintenance";
export type TransactionPhase = "idle" | "active" | "recovering";

export interface RuntimeSnapshot {
  availability: ServiceAvailability;
  pendingAvailability?: ServiceAvailability;
  transactionPhase: TransactionPhase;
}

export interface PresentationPort<TState = unknown> {
  navigate(viewId: string, state: TState): Promise<void>;
  setState(state: TState): Promise<void>;
}

export type RecoveryReason =
  | { kind: "unhandled-error"; error: unknown }
  | { kind: "timeout"; stepId: string }
  | { kind: "requested"; source: string };

export interface RecoveryPort {
  releaseAllHeldMedia(reason: RecoveryReason): Promise<void>;
}

export interface JournalEntry {
  eventId: string;
  timestamp: string;
  traceId?: string;
  data: Record<string, unknown>;
}

export interface JournalPort {
  append(entry: JournalEntry): Promise<void>;
}

export interface TimeoutContext {
  stepId: string;
  timeoutMs: number;
  traceId?: string;
}

export interface TimeoutDecisionPort {
  requestMoreTime(context: TimeoutContext): Promise<"yes" | "no">;
}

export interface TtsRequest {
  text: string;
  locale?: string;
  rate?: number;
}

export interface TtsPort {
  speak(request: TtsRequest): Promise<void>;
  stop(): Promise<void>;
}

export interface VoiceGuideRequest {
  clipId: string;
  locale: string;
}

export interface VoiceGuidePort {
  play(request: VoiceGuideRequest): Promise<void>;
  stop(): Promise<void>;
}

export interface Clock {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => new Date(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface RuntimeConfig {
  defaultLocale: string;
  voiceGuideAssetRoot: string;
  timeouts: Record<string, { action: "end-flow" | "ask-more-time"; timeoutMs: number }>;
}

export function validateRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  if (config.defaultLocale.trim() === "") throw new Error("defaultLocale is required.");
  if (config.voiceGuideAssetRoot.trim() === "") throw new Error("voiceGuideAssetRoot is required.");
  for (const [stepId, timeout] of Object.entries(config.timeouts)) {
    if (!Number.isFinite(timeout.timeoutMs) || timeout.timeoutMs <= 0) {
      throw new Error(`Timeout for ${stepId} must be greater than zero.`);
    }
  }
  return config;
}
