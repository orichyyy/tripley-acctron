import type {
  AudioAssetResolver,
  AudioPlayer,
  VoiceGuideOptions,
  VoiceGuideService,
} from "@tripley-acctron/contracts";

export interface DefaultVoiceGuideServiceOptions {
  resolver: AudioAssetResolver;
  player: AudioPlayer;
  defaultLang?: string;
  fallbackLang?: string;
}

export class DefaultVoiceGuideService implements VoiceGuideService {
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: DefaultVoiceGuideServiceOptions) {}

  public async play(key: string, options: VoiceGuideOptions = {}): Promise<void> {
    const interrupt = options.interrupt ?? "replace";
    if (interrupt === "ignoreIfPlaying" && this.options.player.isPlaying()) {
      return;
    }

    if (interrupt === "queue") {
      this.queue = this.queue.then(() => this.playNow(key, options));
      return this.queue;
    }

    await this.stop();
    await this.playNow(key, options);
  }

  public async stop(): Promise<void> {
    await this.options.player.stop();
  }

  private async playNow(key: string, options: VoiceGuideOptions): Promise<void> {
    const resolveOptions: Pick<VoiceGuideOptions, "lang" | "fallbackLang"> = {};
    const lang = options.lang ?? this.options.defaultLang;
    const fallbackLang = options.fallbackLang ?? this.options.fallbackLang;
    if (lang) {
      resolveOptions.lang = lang;
    }
    if (fallbackLang) {
      resolveOptions.fallbackLang = fallbackLang;
    }
    const src = await this.options.resolver.resolve(key, resolveOptions);
    await this.options.player.play(src);
  }
}
