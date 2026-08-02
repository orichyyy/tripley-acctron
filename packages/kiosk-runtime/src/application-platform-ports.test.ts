import { createKioskProjectPreset } from "@tripley-kit/web-container-kiosk-base";
import type { PluginModule, PluginRuntimeContext } from "@tripley-kit/web-container-plugin-system";
import { describe, expect, it, vi } from "vitest";

import { createKioskApplicationRuntime } from "./application-runtime";

describe("kiosk application platform ports", () => {
  it("exposes platform ports and binds prompt contributions", async () => {
    const disposePrompt = vi.fn(async () => undefined);
    let activatedContext: PluginRuntimeContext | undefined;
    const plugin: PluginModule = {
      activate(context) {
        activatedContext = context;
      },
      manifest: {
        contributes: {
          prompts: [{
            definition: {
              id: "test.prompt",
              locale: "en",
              playbackPolicy: "visualOnly",
              text: "Test prompt",
            },
            id: "test.prompt",
          }],
        },
        id: "test.platform",
        name: "Test platform",
        type: ["project-preset"],
        version: "1.0.0",
      },
    };
    const ports = {
      display: { id: "display" },
      prompt: {
        cancelOperation: async () => undefined,
        dispose: disposePrompt,
        present: async () => ({
          cancel: async () => undefined,
          completed: Promise.resolve({ channel: "visual" as const, status: "visualOnly" as const }),
          id: "prompt-session",
        }),
      },
      tts: { id: "tts" },
      window: { id: "window" },
    };
    const runtime = await createKioskApplicationRuntime({
      appId: "platform-test",
      plugins: [plugin],
      preset: createKioskProjectPreset({
        id: "platform-test",
        plugins: [plugin.manifest.id],
        requiredNativeCapabilities: [],
        storage: { migrations: [], sqliteRequired: false },
      }),
      projectId: "platform-test",
      ports: ports as never,
    });

    expect(runtime.window).toBe(ports.window);
    expect(runtime.display).toBe(ports.display);
    expect(runtime.tts).toBe(ports.tts);
    expect(runtime.prompt).toBe(ports.prompt);
    expect(activatedContext?.prompts).toBe(runtime.prompts);
    expect(runtime.prompts.require("test.prompt", "en").text).toBe("Test prompt");

    await runtime.dispose();
    expect(disposePrompt).toHaveBeenCalledOnce();
  });
});
