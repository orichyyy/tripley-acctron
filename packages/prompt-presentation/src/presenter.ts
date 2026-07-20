import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { TtsPort } from "@tripley-kit/web-container-tts";

import type { AudioAssetCatalog, PromptDefinitionCatalog } from "./catalog";
import type {
  PromptDefinition,
  PromptIntent,
  PromptPresentationResult,
  PromptPresentationSession,
  PromptPresenterPort,
  PromptReadinessResult,
  RecordedPromptPort,
  RecordedPromptSession,
} from "./types";

export interface PromptPresenterOptions {
  readonly prompts: PromptDefinitionCatalog;
  readonly assets: AudioAssetCatalog;
  readonly recorded?: RecordedPromptPort | undefined;
  readonly tts?: TtsPort | undefined;
}

export class PromptPresenter implements PromptPresenterPort {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly dedupe = new Map<string, ManagedSession>();
  private current: ManagedSession | undefined;
  private sequence = 1;

  public constructor(private readonly options: PromptPresenterOptions) {}

  public async present(intent: PromptIntent): Promise<PromptPresentationSession> {
    const key = `${intent.operationId}:${intent.viewRevision}:${intent.promptId}`;
    const existing = this.dedupe.get(key);
    if (existing) {
      return existing;
    }
    const sessionHolder: { value?: ManagedSession } = {};
    const session = new ManagedSession(`prompt-${this.sequence++}`, intent, () => {
      const current = sessionHolder.value;
      return current ? this.cancel(current) : Promise.resolve();
    });
    sessionHolder.value = session;
    this.sessions.set(session.id, session);
    this.dedupe.set(key, session);
    if (this.current && priorityOf(intent.priority) > priorityOf(this.current.intent.priority)) {
      await this.current.cancel("prompt.preempted");
    }
    void this.run(session);
    return session;
  }

  public async cancelOperation(operationId: string, reason = "operation.exit"): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((session) => session.intent.operationId === operationId)
        .map((session) => session.cancel(reason)),
    );
  }

  public async dispose(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((session) => session.cancel("presenter.dispose")),
    );
    await this.options.tts?.stop();
  }

  public async checkReadiness(
    options: { speechRequired?: boolean } = {},
  ): Promise<PromptReadinessResult> {
    const [recordedSupported, ttsSupported] = await Promise.all([
      this.options.recorded?.isSupported() ?? false,
      this.options.tts?.isSupported() ?? false,
    ]);
    return this.options.prompts.checkReadiness(this.options.assets, {
      recordedSupported,
      speechRequired: options.speechRequired,
      ttsSupported,
    });
  }

  private async run(session: ManagedSession): Promise<void> {
    if (session.cancelled) {
      return;
    }
    if (this.current && this.current !== session) {
      await this.current.completed;
    }
    if (session.cancelled) {
      return;
    }
    this.current = session;
    try {
      const prompt = this.options.prompts.require(session.intent.promptId, session.intent.locale);
      validateParameters(prompt, session.intent.parameters);
      const result = await this.play(prompt, session);
      session.resolve(result);
    } catch (error) {
      session.resolve({ channel: "visual", reason: errorMessage(error), status: "failed" });
    } finally {
      if (this.current === session) {
        this.current = undefined;
      }
      this.sessions.delete(session.id);
    }
  }

  private async play(
    prompt: PromptDefinition,
    session: ManagedSession,
  ): Promise<PromptPresentationResult> {
    if (prompt.playbackPolicy === "visualOnly") {
      return { channel: "visual", status: "visualOnly" };
    }
    if (
      prompt.playbackPolicy === "recordedRequired" ||
      prompt.playbackPolicy === "recordedPreferred" ||
      prompt.playbackPolicy === "visualAndRecorded"
    ) {
      try {
        return await this.playRecorded(prompt, session);
      } catch (error) {
        if (prompt.playbackPolicy !== "recordedPreferred" || !prompt.allowTtsFallback) {
          throw error;
        }
      }
    }
    return this.playTts(prompt, session);
  }

  private async playRecorded(
    prompt: PromptDefinition,
    session: ManagedSession,
  ): Promise<PromptPresentationResult> {
    if (!this.options.recorded || !(await this.options.recorded.isSupported())) {
      throw presentationError(
        "prompt.recorded.unavailable",
        "Recorded prompt port is unavailable.",
      );
    }
    if (!prompt.recordedAssetId) {
      throw presentationError(
        "prompt.recorded.assetRequired",
        "Recorded prompt asset is required.",
      );
    }
    const playback = await this.options.recorded.play({
      asset: this.options.assets.require(prompt.recordedAssetId),
      operationId: session.intent.operationId,
      priority: session.intent.priority,
    });
    session.playback = playback;
    await playback.completed;
    return { channel: "recorded", status: session.cancelled ? "cancelled" : "completed" };
  }

  private async playTts(
    prompt: PromptDefinition,
    session: ManagedSession,
  ): Promise<PromptPresentationResult> {
    if (!this.options.tts || !(await this.options.tts.isSupported()) || !prompt.text) {
      throw presentationError("prompt.tts.unavailable", "TTS prompt is unavailable.");
    }
    const text = interpolate(prompt.text, session.intent.parameters);
    const result = await this.options.tts.speak(text, { lang: prompt.locale, mode: "interrupt" });
    if (!result.spoken) {
      throw presentationError("prompt.tts.notSpoken", result.reason ?? "TTS did not speak.");
    }
    return { channel: "tts", status: session.cancelled ? "cancelled" : "completed" };
  }

  private async cancel(session: ManagedSession): Promise<void> {
    await session.playback?.cancel("prompt.cancelled");
    if (this.current === session) {
      await this.options.tts?.stop();
    }
    session.resolve({ channel: session.playback ? "recorded" : "visual", status: "cancelled" });
  }
}

class ManagedSession implements PromptPresentationSession {
  public readonly completed: Promise<PromptPresentationResult>;
  public cancelled = false;
  public playback: RecordedPromptSession | undefined;
  private complete!: (result: PromptPresentationResult) => void;

  public constructor(
    public readonly id: string,
    public readonly intent: PromptIntent,
    private readonly onCancel: (reason?: string) => Promise<void>,
  ) {
    this.completed = new Promise((resolve) => {
      this.complete = resolve;
    });
  }

  public resolve(result: PromptPresentationResult): void {
    this.complete(result);
  }

  public async cancel(reason?: string): Promise<void> {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    await this.onCancel(reason);
  }
}

const validateParameters = (
  prompt: PromptDefinition,
  parameters: Readonly<Record<string, unknown>> | undefined,
): void => {
  const allowed = new Set(prompt.allowedParameters ?? []);
  for (const key of Object.keys(parameters ?? {})) {
    if (!allowed.has(key)) {
      throw presentationError(
        "prompt.parameter.notAllowed",
        `Prompt parameter is not allowed: ${key}`,
      );
    }
  }
};

const interpolate = (text: string, parameters: Readonly<Record<string, unknown>> = {}): string =>
  text.replace(/\{([^}]+)\}/g, (_match, key: string) => String(parameters[key] ?? ""));

const priorityOf = (priority: PromptIntent["priority"]): number =>
  ({ instruction: 1, warning: 2, safety: 3 })[priority];

const presentationError = (code: string, message: string): FrameworkError =>
  new FrameworkError({ category: "dependency", code, message });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
