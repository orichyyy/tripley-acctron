import { describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./index.js";

describe("validateRuntimeConfig", () => {
  it("rejects non-positive timeouts", () => {
    expect(() =>
      validateRuntimeConfig({
        defaultLocale: "en",
        voiceGuideAssetRoot: "/assets/audios",
        timeouts: { account: { action: "ask-more-time", timeoutMs: 0 } },
      }),
    ).toThrow("greater than zero");
  });
});
