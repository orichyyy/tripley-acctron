import type { TtsOptions, TtsService } from "@tripley-acctron/contracts";

export class BrowserSpeechSynthesisTtsService implements TtsService {
  public async speak(text: string, options: TtsOptions = {}): Promise<void> {
    const synthesis = browserSpeechSynthesis();
    synthesis.cancel();
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      Object.assign(utterance, cleanOptions(options));
      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(new Error(`Browser TTS failed: ${event.error}`));
      synthesis.speak(utterance);
    });
  }

  public async stop(): Promise<void> {
    browserSpeechSynthesis().cancel();
  }

  public async isSpeaking(): Promise<boolean> {
    return browserSpeechSynthesis().speaking;
  }
}

function browserSpeechSynthesis(): SpeechSynthesis {
  if (!globalThis.speechSynthesis) {
    throw new Error("Browser speech synthesis is unavailable.");
  }
  return globalThis.speechSynthesis;
}

function cleanOptions(options: TtsOptions): Partial<SpeechSynthesisUtterance> {
  return {
    ...(options.lang ? { lang: options.lang } : {}),
    ...(options.rate !== undefined ? { rate: options.rate } : {}),
    ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
    ...(options.volume !== undefined ? { volume: options.volume } : {}),
  };
}
