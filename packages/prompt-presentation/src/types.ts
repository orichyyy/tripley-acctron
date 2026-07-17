export type PromptPriority = "instruction" | "warning" | "safety";

export type PromptPlaybackPolicy =
  | "recordedRequired"
  | "recordedPreferred"
  | "ttsRequired"
  | "visualOnly"
  | "visualAndRecorded";

export interface PromptDefinition {
  readonly id: string;
  readonly locale: string;
  readonly text?: string | undefined;
  readonly recordedAssetId?: string | undefined;
  readonly playbackPolicy: PromptPlaybackPolicy;
  readonly allowTtsFallback?: boolean | undefined;
  readonly allowedParameters?: readonly string[] | undefined;
}

export interface AudioAssetDescriptor {
  readonly id: string;
  readonly locale: string;
  readonly version: string;
  readonly source: string;
  readonly integrity?: string | undefined;
  readonly required?: boolean | undefined;
}

export interface PromptIntent {
  readonly promptId: string;
  readonly locale: string;
  readonly operationId: string;
  readonly viewRevision: number;
  readonly priority: PromptPriority;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
  readonly speechRequired?: boolean | undefined;
}

export interface RecordedPromptRequest {
  readonly asset: AudioAssetDescriptor;
  readonly operationId: string;
  readonly priority: PromptPriority;
}

export interface RecordedPromptSession {
  readonly id: string;
  readonly completed: Promise<void>;
  cancel(reason?: string): Promise<void>;
}

export interface RecordedPromptPort {
  isSupported(): Promise<boolean>;
  play(request: RecordedPromptRequest): Promise<RecordedPromptSession>;
}

export interface PromptPresentationResult {
  readonly status: "completed" | "cancelled" | "failed" | "visualOnly";
  readonly channel: "recorded" | "tts" | "visual";
  readonly reason?: string | undefined;
}

export interface PromptPresentationSession {
  readonly id: string;
  readonly completed: Promise<PromptPresentationResult>;
  cancel(reason?: string): Promise<void>;
}

export interface PromptPresenterPort {
  present(intent: PromptIntent): Promise<PromptPresentationSession>;
  cancelOperation(operationId: string, reason?: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface PromptReadinessResult {
  readonly status: "ready" | "degraded" | "failed";
  readonly missingPromptIds: readonly string[];
  readonly missingAssetIds: readonly string[];
  readonly unavailableChannels: readonly ("recorded" | "tts")[];
}

export interface PromptReadinessOptions {
  readonly recordedSupported: boolean;
  readonly speechRequired?: boolean | undefined;
  readonly ttsSupported: boolean;
}
