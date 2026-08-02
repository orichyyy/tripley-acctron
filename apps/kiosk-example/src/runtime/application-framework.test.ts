import {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import { MemoryScopedStore } from "@tripley-kit/web-container-scoped-store";
import { FrameworkUiPort } from "@tripley-kit/web-container-ui-port";
import { describe, expect, it } from "vitest";

import {
  EXAMPLE_READY_CONDITION_ID,
  EXAMPLE_STATUS_COMMAND_ID,
  createExampleFrameworkApplication,
} from "./application-framework";

describe("kiosk example framework application", () => {
  it("starts from its preset and binds plugin conditions, commands, and health checks", async () => {
    const application = await createExampleFrameworkApplication({
      deviceLocks: new DeviceLockManager(),
      devices: new DeviceRegistry(),
      inputSources: new InputSourceRegistry(),
      scopedStore: new MemoryScopedStore(),
      ui: new FrameworkUiPort({ navigate: () => undefined }),
    });

    expect(application.pluginManager.getState("kiosk-example.foundation")).toBe("activated");
    expect(
      await application.conditions.evaluateBoolean(EXAMPLE_READY_CONDITION_ID, {}),
    ).toBe(true);
    expect(
      await application.commands.canExecute(
        EXAMPLE_STATUS_COMMAND_ID,
        { conditions: application.conditions },
        {},
      ),
    ).toEqual({ allowed: true });
    await expect(
      application.commands.execute(
        EXAMPLE_STATUS_COMMAND_ID,
        { conditions: application.conditions },
        {},
      ),
    ).resolves.toEqual({ ready: true });
    await expect(application.healthChecks.runAll()).resolves.toContainEqual({
      id: "kiosk-example.application",
      status: "pass",
    });

    await application.dispose();
  });
});
