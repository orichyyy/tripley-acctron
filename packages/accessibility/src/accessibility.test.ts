import { describe, expect, test } from "vitest";
import { StaticAudioAssetResolver } from "./audio-asset-resolver";
import { HeadlessAudioPlayer } from "./audio-players";
import { NoopTtsService } from "./noop-tts-service";
import { DefaultVoiceGuideService } from "./voice-guide-service";

describe("accessibility services", () => {
  test("noop tts records speak requests", async () => {
    const tts = new NoopTtsService();
    await tts.speak("hello", { lang: "en" });
    expect(tts.calls).toEqual([{ text: "hello", options: { lang: "en" } }]);
    await expect(tts.isSpeaking()).resolves.toBe(false);
  });

  test("asset resolver uses language and fallback", async () => {
    const resolver = new StaticAudioAssetResolver({
      available: (src) => src.includes("/en/"),
    });
    await expect(
      resolver.resolve("account.input", { lang: "zh", fallbackLang: "en" }),
    ).resolves.toBe("assets/audios/en/account.input.mp3");
  });

  test("voice guide resolves assets and plays through player", async () => {
    const player = new HeadlessAudioPlayer();
    const voiceGuide = new DefaultVoiceGuideService({
      resolver: new StaticAudioAssetResolver({ defaultLang: "zh" }),
      player,
    });
    await voiceGuide.play("card.take");
    expect(player.played).toEqual(["assets/audios/zh/card.take.mp3"]);
  });
});
