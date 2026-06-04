import type { AudioAssetResolver, VoiceGuideOptions } from "@tripley-acctron/contracts";

export interface StaticAudioAssetResolverOptions {
  basePath?: string;
  extension?: string;
  defaultLang?: string;
  available?: (src: string) => boolean | Promise<boolean>;
}

export class StaticAudioAssetResolver implements AudioAssetResolver {
  public constructor(private readonly options: StaticAudioAssetResolverOptions = {}) {}

  public async resolve(
    key: string,
    options: Pick<VoiceGuideOptions, "lang" | "fallbackLang"> = {},
  ): Promise<string> {
    const lang = options.lang ?? this.options.defaultLang ?? "zh";
    const primary = this.toPath(lang, key);
    if (!this.options.available || (await this.options.available(primary))) {
      return primary;
    }

    const fallbackLang = options.fallbackLang;
    if (fallbackLang) {
      const fallback = this.toPath(fallbackLang, key);
      if (!this.options.available || (await this.options.available(fallback))) {
        return fallback;
      }
    }
    return primary;
  }

  private toPath(lang: string, key: string): string {
    const basePath = this.options.basePath ?? "assets/audios";
    const extension = this.options.extension ?? "mp3";
    return `${trimEndSlash(basePath)}/${lang}/${key}.${extension}`;
  }
}

function trimEndSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
