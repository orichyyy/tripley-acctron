export interface TtsOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface TtsService {
  speak(text: string, options?: TtsOptions): Promise<void>;
  stop(): Promise<void>;
  isSpeaking(): Promise<boolean>;
}

export type VoiceGuideInterrupt = "replace" | "queue" | "ignoreIfPlaying";

export interface VoiceGuideOptions {
  lang?: string;
  fallbackLang?: string;
  interrupt?: VoiceGuideInterrupt;
}

export interface VoiceGuideService {
  play(key: string, options?: VoiceGuideOptions): Promise<void>;
  stop(): Promise<void>;
}

export interface AudioAssetResolver {
  resolve(key: string, options?: Pick<VoiceGuideOptions, "lang" | "fallbackLang">): Promise<string>;
}

export interface AudioPlayer {
  play(src: string): Promise<void>;
  stop(): Promise<void>;
  isPlaying(): boolean;
}
