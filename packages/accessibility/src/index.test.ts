import { describe, expect, it, vi } from "vitest";
import { BrowserVoiceGuide } from "./index.js";

describe("BrowserVoiceGuide", () => {
  it("resolves locale-specific assets", async () => {
    const play = vi.fn(async () => {});
    const createAudio = vi.fn(() => ({ play, pause: vi.fn() }) as unknown as HTMLAudioElement);
    const guide = new BrowserVoiceGuide({ createAudio });
    await guide.play({ clipId: "take-card", locale: "en" });
    expect(createAudio).toHaveBeenCalledWith("/assets/audios/en/take-card.mp3");
  });
});
