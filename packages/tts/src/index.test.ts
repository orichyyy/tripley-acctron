import { describe, expect, it } from "vitest";

import { BrowserSpeechSynthesisTtsAdapter } from "./index";

describe("BrowserSpeechSynthesisTtsAdapter", () => {
  it("falls back to noop when browser speech synthesis is unavailable", async () => {
    const tts = new BrowserSpeechSynthesisTtsAdapter({ synthesis: undefined });

    await expect(tts.isSupported()).resolves.toBe(false);
    await expect(tts.speak("hello")).resolves.toEqual({
      adapter: "noop",
      reason: "speechSynthesis.unavailable",
      spoken: false,
    });
  });

  it("speaks through browser speech synthesis when available", async () => {
    const spoken: string[] = [];
    const tts = new BrowserSpeechSynthesisTtsAdapter({
      synthesis: {
        cancel: () => {},
        getVoices: () => [],
        pause: () => {},
        resume: () => {},
        speak: (utterance) => {
          spoken.push(utterance.text);
          utterance.onend?.();
        },
      },
      utteranceFactory: (text) => ({ text }),
    });

    await expect(tts.speak("withdrawal selected")).resolves.toEqual({
      adapter: "browser",
      spoken: true,
    });
    expect(spoken).toEqual(["withdrawal selected"]);
  });
});
