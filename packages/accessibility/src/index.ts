import type {
  TtsPort,
  TtsRequest,
  VoiceGuidePort,
  VoiceGuideRequest,
} from "@tripley-acctron/contracts";

export class BrowserTts implements TtsPort {
  public async speak(request: TtsRequest): Promise<void> {
    if (
      globalThis.speechSynthesis === undefined ||
      globalThis.SpeechSynthesisUtterance === undefined
    ) {
      throw new Error("Browser speech synthesis is unavailable.");
    }
    const utterance = new SpeechSynthesisUtterance(request.text);
    if (request.locale !== undefined) utterance.lang = request.locale;
    if (request.rate !== undefined) utterance.rate = request.rate;
    globalThis.speechSynthesis.speak(utterance);
  }

  public async stop(): Promise<void> {
    globalThis.speechSynthesis?.cancel();
  }
}

export interface BrowserVoiceGuideOptions {
  assetRoot?: string;
  extension?: string;
  createAudio?: (url: string) => HTMLAudioElement;
}

export class BrowserVoiceGuide implements VoiceGuidePort {
  private readonly assetRoot: string;
  private readonly extension: string;
  private readonly createAudio: (url: string) => HTMLAudioElement;
  private active: HTMLAudioElement | undefined;

  public constructor(options: BrowserVoiceGuideOptions = {}) {
    this.assetRoot = options.assetRoot ?? "/assets/audios";
    this.extension = options.extension ?? "mp3";
    this.createAudio =
      options.createAudio ??
      ((url) => {
        if (globalThis.Audio === undefined)
          throw new Error("Browser audio playback is unavailable.");
        return new Audio(url);
      });
  }

  public async play(request: VoiceGuideRequest): Promise<void> {
    await this.stop();
    const audio = this.createAudio(
      `${this.assetRoot}/${request.locale}/${request.clipId}.${this.extension}`,
    );
    this.active = audio;
    await audio.play();
  }

  public async stop(): Promise<void> {
    this.active?.pause();
    this.active = undefined;
  }
}
