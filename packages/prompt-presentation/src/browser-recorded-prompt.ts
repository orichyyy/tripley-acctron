import { FrameworkError } from "@tripley-kit/web-container-errors";

import type { RecordedPromptPort, RecordedPromptRequest, RecordedPromptSession } from "./types";

export interface BrowserAudioLike {
  currentTime: number;
  onended: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  play(): Promise<void>;
  pause(): void;
}

export interface BrowserRecordedPromptAdapterOptions {
  readonly audioFactory?: ((source: string) => BrowserAudioLike) | undefined;
}

export class BrowserRecordedPromptAdapter implements RecordedPromptPort {
  private readonly audioFactory: ((source: string) => BrowserAudioLike) | undefined;
  private sequence = 1;

  public constructor(options: BrowserRecordedPromptAdapterOptions = {}) {
    this.audioFactory = options.audioFactory ?? browserAudioFactory();
  }

  public async isSupported(): Promise<boolean> {
    return this.audioFactory !== undefined;
  }

  public async play(request: RecordedPromptRequest): Promise<RecordedPromptSession> {
    if (!this.audioFactory) {
      throw new FrameworkError({
        category: "dependency",
        code: "prompt.recorded.unsupported",
        message: "Recorded prompt playback is unavailable.",
      });
    }
    const audio = this.audioFactory(request.asset.source);
    const completed = new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = (event) => reject(event);
    });
    await audio.play();
    let cancelled = false;
    return {
      id: `recorded-prompt-${this.sequence++}`,
      completed,
      cancel: async () => {
        if (cancelled) {
          return;
        }
        cancelled = true;
        audio.pause();
        audio.currentTime = 0;
        audio.onended?.(new Event("cancel"));
      },
    };
  }
}

const browserAudioFactory = (): ((source: string) => BrowserAudioLike) | undefined => {
  const candidate = globalThis as typeof globalThis & {
    Audio?: new (source: string) => BrowserAudioLike;
  };
  const AudioConstructor = candidate.Audio;
  return AudioConstructor ? (source) => new AudioConstructor(source) : undefined;
};
