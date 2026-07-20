import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { NativePort } from "@tripley-kit/web-container-native-adapter";

export const ttsPackageName = "@tripley-kit/web-container-tts";

export interface TtsSpeakOptions {
  readonly voiceId?: string | undefined;
  readonly lang?: string | undefined;
  readonly rate?: number | undefined;
  readonly pitch?: number | undefined;
  readonly volume?: number | undefined;
  readonly mode?: "queue" | "interrupt" | "replace" | undefined;
  readonly traceId?: string | undefined;
}

export interface TtsStopOptions {
  readonly traceId?: string | undefined;
}

export interface TtsSpeakResult {
  readonly spoken: boolean;
  readonly adapter: "browser" | "native" | "noop";
  readonly reason?: string | undefined;
}

export interface TtsVoice {
  readonly id: string;
  readonly name: string;
  readonly lang?: string | undefined;
  readonly default?: boolean | undefined;
}

export interface TtsPort {
  speak(text: string, options?: TtsSpeakOptions): Promise<TtsSpeakResult>;
  stop(options?: TtsStopOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  listVoices(): Promise<TtsVoice[]>;
  isSupported(): Promise<boolean>;
}

export interface BrowserSpeechSynthesisLike {
  readonly speaking?: boolean;
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): SpeechSynthesisVoiceLike[];
}

export interface SpeechSynthesisUtteranceLike {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: SpeechSynthesisVoiceLike | null | undefined;
  onend?: (() => void) | undefined;
  onerror?: ((event: unknown) => void) | undefined;
}

export interface SpeechSynthesisVoiceLike {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly default: boolean;
}

export interface BrowserSpeechSynthesisTtsAdapterOptions {
  readonly synthesis?: BrowserSpeechSynthesisLike | undefined;
  readonly utteranceFactory?: ((text: string) => SpeechSynthesisUtteranceLike) | undefined;
}

export class BrowserSpeechSynthesisTtsAdapter implements TtsPort {
  private readonly synthesis: BrowserSpeechSynthesisLike | undefined;
  private readonly utteranceFactory: (text: string) => SpeechSynthesisUtteranceLike;

  public constructor(options: BrowserSpeechSynthesisTtsAdapterOptions = {}) {
    this.synthesis = options.synthesis ?? getBrowserSpeechSynthesis();
    this.utteranceFactory = options.utteranceFactory ?? createBrowserUtterance;
  }

  public async speak(text: string, options: TtsSpeakOptions = {}): Promise<TtsSpeakResult> {
    if (!this.synthesis) {
      return { adapter: "noop", reason: "speechSynthesis.unavailable", spoken: false };
    }

    if (options.mode === "interrupt" || options.mode === "replace") {
      this.synthesis.cancel();
    }

    const utterance = this.utteranceFactory(text);
    applySpeechOptions(utterance, options, this.synthesis.getVoices());

    await new Promise<void>((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(event);
      this.synthesis?.speak(utterance);
    });

    return { adapter: "browser", spoken: true };
  }

  public async stop(): Promise<void> {
    this.synthesis?.cancel();
  }

  public async pause(): Promise<void> {
    this.synthesis?.pause();
  }

  public async resume(): Promise<void> {
    this.synthesis?.resume();
  }

  public async listVoices(): Promise<TtsVoice[]> {
    return (
      this.synthesis?.getVoices().map((voice) => ({
        default: voice.default,
        id: voice.voiceURI,
        lang: voice.lang,
        name: voice.name,
      })) ?? []
    );
  }

  public async isSupported(): Promise<boolean> {
    return this.synthesis !== undefined;
  }
}

export class NativeTtsPlaceholderAdapter implements TtsPort {
  public constructor(private readonly native?: NativePort | undefined) {}

  public async speak(_text: string, _options: TtsSpeakOptions = {}): Promise<TtsSpeakResult> {
    await this.requireNativeTts();
    return { adapter: "native", reason: "native.tts.placeholder", spoken: false };
  }

  public async stop(): Promise<void> {
    await this.requireNativeTts();
  }

  public async pause(): Promise<void> {
    await this.requireNativeTts();
  }

  public async resume(): Promise<void> {
    await this.requireNativeTts();
  }

  public async listVoices(): Promise<TtsVoice[]> {
    await this.requireNativeTts();
    return [];
  }

  public async isSupported(): Promise<boolean> {
    if (!this.native) {
      return false;
    }

    try {
      await this.native.requireCapabilities(["tts.speak"]);
      return true;
    } catch {
      return false;
    }
  }

  private async requireNativeTts(): Promise<void> {
    if (!this.native) {
      throw new FrameworkError({
        category: "native",
        code: "tts.native.unavailable",
        message: "Native TTS is not available.",
      });
    }

    await this.native.requireCapabilities(["tts.speak"]);
  }
}

const getBrowserSpeechSynthesis = (): BrowserSpeechSynthesisLike | undefined => {
  const candidate = globalThis as typeof globalThis & {
    speechSynthesis?: BrowserSpeechSynthesisLike;
  };
  return candidate.speechSynthesis;
};

const createBrowserUtterance = (text: string): SpeechSynthesisUtteranceLike => {
  const candidate = globalThis as typeof globalThis & {
    SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtteranceLike;
  };
  if (!candidate.SpeechSynthesisUtterance) {
    throw new FrameworkError({
      category: "dependency",
      code: "tts.browser.utteranceUnavailable",
      message: "SpeechSynthesisUtterance is not available.",
    });
  }

  return new candidate.SpeechSynthesisUtterance(text) as unknown as SpeechSynthesisUtteranceLike;
};

const applySpeechOptions = (
  utterance: SpeechSynthesisUtteranceLike,
  options: TtsSpeakOptions,
  voices: readonly SpeechSynthesisVoiceLike[],
): void => {
  if (options.lang !== undefined) {
    utterance.lang = options.lang;
  }
  if (options.rate !== undefined) {
    utterance.rate = options.rate;
  }
  if (options.pitch !== undefined) {
    utterance.pitch = options.pitch;
  }
  if (options.volume !== undefined) {
    utterance.volume = options.volume;
  }
  if (options.voiceId !== undefined) {
    const voice = voices.find((candidate) => candidate.voiceURI === options.voiceId);
    if (voice !== undefined) {
      utterance.voice = voice;
    }
  }
};
