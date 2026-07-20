import type { TtsPort, TtsSpeakResult } from "@tripley-kit/web-container-tts";
import { describe, expect, it } from "vitest";

import { AudioAssetCatalog, PromptDefinitionCatalog } from "./catalog";
import { PromptPresenter } from "./presenter";
import type { RecordedPromptPort, RecordedPromptSession } from "./types";

describe("PromptPresenter", () => {
  it("uses only a catalog asset for a required recorded prompt", async () => {
    const recorded = new MemoryRecordedPromptPort();
    const presenter = createPresenter(recorded, new MemoryTts());
    const session = await presenter.present(intent("pin.enter", 1));

    recorded.finish();

    await expect(session.completed).resolves.toEqual({ channel: "recorded", status: "completed" });
    expect(recorded.assets).toEqual(["bank.pin.enter"]);
  });

  it("falls back to TTS only when the prompt policy permits it", async () => {
    const tts = new MemoryTts();
    const presenter = createPresenter(undefined, tts);
    const session = await presenter.present(intent("card.take", 2));

    await expect(session.completed).resolves.toEqual({ channel: "tts", status: "completed" });
    expect(tts.spoken).toEqual(["Please take your card"]);
  });

  it("deduplicates view revisions and cancels operation audio", async () => {
    const recorded = new MemoryRecordedPromptPort();
    const presenter = createPresenter(recorded, new MemoryTts());
    const first = await presenter.present(intent("pin.enter", 3));
    const duplicate = await presenter.present(intent("pin.enter", 3));

    expect(duplicate.id).toBe(first.id);
    await presenter.cancelOperation("operation-1", "node.exit");

    await expect(first.completed).resolves.toMatchObject({ status: "cancelled" });
    expect(recorded.cancelled).toBe(true);
  });

  it("degrades only when a recorded-preferred prompt has an allowed TTS fallback", () => {
    const assets = new AudioAssetCatalog();
    const prompts = new PromptDefinitionCatalog();
    prompts.register({
      allowTtsFallback: true,
      id: "card.take",
      locale: "en",
      playbackPolicy: "recordedPreferred",
      recordedAssetId: "bank.card.take",
      text: "Please take your card",
    });

    expect(
      prompts.checkReadiness(assets, { recordedSupported: false, ttsSupported: true }),
    ).toMatchObject({
      missingAssetIds: ["bank.card.take"],
      status: "degraded",
      unavailableChannels: ["recorded"],
    });
  });

  it("fails readiness for required audio and accessibility-required TTS", () => {
    const assets = new AudioAssetCatalog();
    const prompts = new PromptDefinitionCatalog();
    prompts.register({
      id: "cash.take",
      locale: "en",
      playbackPolicy: "recordedRequired",
      recordedAssetId: "bank.cash.take",
    });
    prompts.register({ id: "welcome", locale: "en", playbackPolicy: "visualOnly" });

    expect(
      prompts.checkReadiness(assets, {
        recordedSupported: false,
        speechRequired: true,
        ttsSupported: false,
      }),
    ).toMatchObject({
      status: "failed",
      unavailableChannels: expect.arrayContaining(["recorded", "tts"]),
    });
  });
});

const createPresenter = (recorded: RecordedPromptPort | undefined, tts: TtsPort) => {
  const assets = new AudioAssetCatalog();
  assets.register({
    id: "bank.pin.enter",
    locale: "en",
    source: "/assets/pin-enter.wav",
    version: "1",
  });
  const prompts = new PromptDefinitionCatalog();
  prompts.register({
    id: "pin.enter",
    locale: "en",
    playbackPolicy: "recordedRequired",
    recordedAssetId: "bank.pin.enter",
  });
  prompts.register({
    allowTtsFallback: true,
    id: "card.take",
    locale: "en",
    playbackPolicy: "recordedPreferred",
    recordedAssetId: "bank.card.take",
    text: "Please take your card",
  });
  return new PromptPresenter({ assets, prompts, recorded, tts });
};

const intent = (promptId: string, viewRevision: number) => ({
  locale: "en",
  operationId: "operation-1",
  priority: "instruction" as const,
  promptId,
  viewRevision,
});

class MemoryRecordedPromptPort implements RecordedPromptPort {
  public assets: string[] = [];
  public cancelled = false;
  private finishPlayback: (() => void) | undefined;

  public async isSupported(): Promise<boolean> {
    return true;
  }

  public async play(request: { asset: { id: string } }): Promise<RecordedPromptSession> {
    this.assets.push(request.asset.id);
    const completed = new Promise<void>((resolve) => {
      this.finishPlayback = resolve;
    });
    return {
      cancel: async () => {
        this.cancelled = true;
        this.finish();
      },
      completed,
      id: "recorded-1",
    };
  }

  public finish(): void {
    this.finishPlayback?.();
  }
}

class MemoryTts implements TtsPort {
  public spoken: string[] = [];
  public async speak(text: string): Promise<TtsSpeakResult> {
    this.spoken.push(text);
    return { adapter: "browser", spoken: true };
  }
  public async stop(): Promise<void> {}
  public async pause(): Promise<void> {}
  public async resume(): Promise<void> {}
  public async listVoices(): Promise<[]> {
    return [];
  }
  public async isSupported(): Promise<boolean> {
    return true;
  }
}
