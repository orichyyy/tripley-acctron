import type {
  TtsOptions,
  TtsService,
  VoiceGuideOptions,
  VoiceGuideService,
} from "@tripley-acctron/contracts";
import { describe, expect, test } from "vitest";
import { InputSources } from "./input-sources";
import { defineConfirmStep } from "./confirm-step";
import { createStandardStepTestKit, flushPromises, journalEntries } from "./standard-step-test-kit";
import { defineTextInputStep } from "./text-input-step";

describe("step policy", () => {
  test("plays voice guide and speaks TTS when prompt starts", async () => {
    const voiceGuide = new RecordingVoiceGuide();
    const tts = new RecordingTts();
    const kit = createStandardStepTestKit(
      {
        input: defineConfirmStep({
          id: "confirm",
          screen: "confirm",
          voiceGuide: "account.confirm",
          tts: (ctx) => `node:${ctx.nodeId}`,
          routes: { confirmed: "Confirmed" },
        }),
      },
      { voiceGuide, tts },
    );

    const run = kit.flow.run("demo");
    await flushPromises(6);

    expect(voiceGuide.played).toEqual(["account.confirm"]);
    expect(tts.spoken).toEqual(["node:input"]);

    kit.devices.pinpad.press("enter");
    await expect(run).resolves.toEqual({ flowId: "demo", endName: "Confirmed" });
  });

  test("skips disabled prompt guidance and audit", async () => {
    const voiceGuide = new RecordingVoiceGuide();
    const kit = createStandardStepTestKit(
      {
        input: defineTextInputStep({
          id: "input",
          screen: "input",
          voiceGuide: false,
          audit: false,
          sources: [InputSources.pinpad.numeric()],
          routes: { accepted: "Valid" },
        }),
      },
      { voiceGuide },
    );

    const run = kit.flow.run("demo");
    kit.devices.pinpad.press("1");
    kit.devices.pinpad.press("enter");
    await expect(run).resolves.toEqual({ flowId: "demo", endName: "Valid" });

    expect(voiceGuide.played).toEqual([]);
    expect(journalEntries(kit)).toEqual([]);
  });

  test("logs failed interaction when a failed route exists", async () => {
    const kit = createStandardStepTestKit({
      input: defineTextInputStep({
        id: "input",
        screen: "input",
        sources: [InputSources.pinpad.numeric()],
        validate: () => {
          throw new Error("validation failed");
        },
        routes: { accepted: "Valid", failed: "Failed" },
      }),
    });

    const run = kit.flow.run("demo");
    kit.devices.pinpad.press("1");
    kit.devices.pinpad.press("enter");
    await expect(run).resolves.toEqual({ flowId: "demo", endName: "Failed" });
    expect(JSON.stringify(kit.logger)).toContain("Standard step failed");
  });
});

class RecordingVoiceGuide implements VoiceGuideService {
  public readonly played: string[] = [];

  public async play(key: string, _options?: VoiceGuideOptions): Promise<void> {
    this.played.push(key);
  }

  public async stop(): Promise<void> {}
}

class RecordingTts implements TtsService {
  public readonly spoken: string[] = [];

  public async speak(text: string, _options?: TtsOptions): Promise<void> {
    this.spoken.push(text);
  }

  public async stop(): Promise<void> {}

  public async isSpeaking(): Promise<boolean> {
    return false;
  }
}
