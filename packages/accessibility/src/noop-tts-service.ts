import type { TtsOptions, TtsService } from "@tripley-acctron/contracts";

export interface TtsCall {
  text: string;
  options?: TtsOptions;
}

export class NoopTtsService implements TtsService {
  public readonly calls: TtsCall[] = [];
  private speaking = false;

  public async speak(text: string, options?: TtsOptions): Promise<void> {
    this.calls.push(options ? { text, options } : { text });
    this.speaking = false;
  }

  public async stop(): Promise<void> {
    this.speaking = false;
  }

  public async isSpeaking(): Promise<boolean> {
    return this.speaking;
  }
}
