# 19. TTS Service

## Purpose

Provide text-to-speech through a framework port. Default v1 uses browser `window.speechSynthesis`, with later native SDK adapter supported.

## TtsPort

```ts
export interface TtsPort {
  speak(text: string, options?: TtsSpeakOptions): Promise<TtsSpeakResult>;
  stop(options?: TtsStopOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  listVoices(): Promise<TtsVoice[]>;
  isSupported(): Promise<boolean>;
}
```

## Options

```ts
export interface TtsSpeakOptions {
  voiceId?: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  mode?: 'queue' | 'interrupt' | 'replace';
  traceId?: string;
}
```

## Default implementation

`BrowserSpeechSynthesisTtsAdapter` uses `window.speechSynthesis`.

## Usage in Command

```ts
options: {
  tts: { text: '您选择了取款', mode: 'interrupt' }
}
```

## Usage in Flow

```ts
await ctx.tts.speak('请取走您的银行卡', { mode: 'replace' });
```

## Native adapter

Future native TTS is tracked as `NATIVE-API-011`. Business code must depend on `TtsPort`, not browser or native APIs directly.

## Accessibility

TTS is integrated with AccessibilityService. Blind mode can automatically enable more verbose prompts and flow interrupts.
