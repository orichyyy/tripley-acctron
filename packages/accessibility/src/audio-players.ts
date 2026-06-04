import type { AudioPlayer } from "@tripley-acctron/contracts";

export class HeadlessAudioPlayer implements AudioPlayer {
  public readonly played: string[] = [];
  private active = false;

  public async play(src: string): Promise<void> {
    this.played.push(src);
    this.active = false;
  }

  public async stop(): Promise<void> {
    this.active = false;
  }

  public isPlaying(): boolean {
    return this.active;
  }
}

export class BrowserAudioPlayer implements AudioPlayer {
  private audio: HTMLAudioElement | undefined;

  public async play(src: string): Promise<void> {
    await this.stop();
    const audio = new Audio(src);
    this.audio = audio;
    await audio.play();
  }

  public async stop(): Promise<void> {
    if (!this.audio) {
      return;
    }
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio = undefined;
  }

  public isPlaying(): boolean {
    return this.audio !== undefined && !this.audio.paused;
  }
}
