import type { TripleyNative } from "@tripley-kit/native";
import { describe, expect, test } from "vitest";
import { TripleyNativePorts } from "./native-adapter";

describe("native adapter", () => {
  test("exposes runtime info through native SDK", async () => {
    const ports = new TripleyNativePorts({
      runtime: {
        getInfo: async () => ({
          platform: "windows",
          arch: "x64",
          family: "windows",
          exePath: null,
          capabilities: ["runtime"],
          policyMode: "test",
        }),
        listCapabilities: async () => ["runtime"],
      },
    } as TripleyNative);

    await expect(ports.runtime.getInfo()).resolves.toMatchObject({
      platform: "windows",
      capabilities: ["runtime"],
    });
  });
});
