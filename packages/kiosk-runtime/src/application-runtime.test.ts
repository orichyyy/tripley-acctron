import { LocalEventBus } from "@tripley-kit/web-container-event-bus";
import { defineFlow } from "@tripley-kit/web-container-flow-engine";
import { createKioskProjectPreset } from "@tripley-kit/web-container-kiosk-base";
import type { PluginModule } from "@tripley-kit/web-container-plugin-system";
import { describe, expect, it } from "vitest";

import { createKioskApplicationRuntime } from "./application-runtime";
import type { KioskApplicationLifecycleEventMap } from "./application-runtime-types";

const terminalFlow = defineFlow({
  id: "project.test.flow",
  nodes: {
    done: { id: "done", kind: "terminal", output: { ok: true } },
  },
  recovery: { mode: "discard" },
  startNodeId: "done",
  trace: { summaryOnly: true },
  version: "1.0.0",
});

const applicationPlugin = (calls: string[]): PluginModule => ({
  activate: () => {
    calls.push("activate");
  },
  deactivate: () => {
    calls.push("deactivate");
  },
  dispose: () => {
    calls.push("dispose");
  },
  manifest: {
    contributes: {
      commands: [{
        command: {
          execute: async () => ({ accepted: true }),
          id: "project.test.command",
        },
        id: "project.test.command",
      }],
      conditions: [{
        condition: { evaluate: () => true, id: "project.test.available" },
        id: "project.test.available",
      }],
      flows: [{ definition: terminalFlow, id: terminalFlow.id }],
      healthChecks: [{
        check: {
          id: "project.test.health",
          run: async () => ({ id: "project.test.health", status: "pass" as const }),
        },
        id: "project.test.health",
      }],
    },
    id: "project.test.plugin",
    name: "Project Test Plugin",
    type: ["command", "condition", "flow"],
    version: "1.0.0",
  },
});

describe("createKioskApplicationRuntime", () => {
  it("consumes a preset and binds activated plugin contributions", async () => {
    const calls: string[] = [];
    const middlewareCalls: string[] = [];
    const events: string[] = [];
    const eventBus = new LocalEventBus<KioskApplicationLifecycleEventMap>();
    eventBus.subscribe("core.app.initializing", () => {
      events.push("initializing");
    });
    eventBus.subscribe("core.app.ready", () => {
      events.push("ready");
    });
    eventBus.subscribe("core.app.disposed", () => {
      events.push("disposed");
    });
    const preset = createKioskProjectPreset({
      commandMiddleware: [{
        beforeExecute: async () => {
          middlewareCalls.push("before");
        },
        id: "project.test.middleware",
      }],
      healthChecks: [],
      id: "project.test",
      plugins: ["project.test.plugin"],
      requiredNativeCapabilities: [],
      storage: { migrations: [], sqliteRequired: false },
    });

    const runtime = await createKioskApplicationRuntime({
      appId: "test.app",
      plugins: [applicationPlugin(calls)],
      ports: { eventBus },
      preset,
      projectId: "test.project",
    });

    await expect(runtime.conditions.evaluateBoolean("project.test.available", {}))
      .resolves.toBe(true);
    await expect(runtime.commands.execute("project.test.command", {}, undefined))
      .resolves.toEqual({ accepted: true });
    const flow = await runtime.flowEngine.start("project.test.flow", {});
    await expect(flow.completion).resolves.toMatchObject({ status: "completed" });
    await expect(runtime.healthChecks.runAll()).resolves.toEqual([
      { id: "project.test.health", status: "pass" },
    ]);
    expect(middlewareCalls).toEqual(["before"]);
    expect(events).toEqual(["initializing", "ready"]);

    await runtime.dispose();

    expect(calls).toEqual(["activate", "deactivate", "dispose"]);
    expect(events).toEqual(["initializing", "ready", "disposed"]);
  });

  it("fails before plugin installation when a required capability is unavailable", async () => {
    let installed = false;
    const plugin: PluginModule = {
      install: () => {
        installed = true;
      },
      manifest: {
        id: "project.test.plugin",
        name: "Project Test Plugin",
        type: ["service"],
        version: "1.0.0",
      },
    };
    const preset = createKioskProjectPreset({
      plugins: [plugin.manifest.id],
      requiredNativeCapabilities: ["window.open"],
      storage: { migrations: [], sqliteRequired: false },
    });

    await expect(createKioskApplicationRuntime({
      appId: "test.app",
      capabilities: { "window.open": "unavailable" },
      plugins: [plugin],
      preset,
      projectId: "test.project",
    })).rejects.toMatchObject({ code: "kiosk.application.capability.missing" });
    expect(installed).toBe(false);
  });

  it("does not bind contributions from an optional plugin that failed activation", async () => {
    const plugin: PluginModule = {
      activate: () => {
        throw new Error("not installed");
      },
      manifest: {
        contributes: {
          commands: [{
            command: { execute: async () => undefined, id: "optional.command" },
            id: "optional.command",
          }],
        },
        id: "project.optional",
        name: "Optional",
        optional: true,
        type: ["command"],
        version: "1.0.0",
      },
    };
    const preset = createKioskProjectPreset({
      plugins: [plugin.manifest.id],
      requiredNativeCapabilities: [],
      storage: { migrations: [], sqliteRequired: false },
    });

    const runtime = await createKioskApplicationRuntime({
      appId: "test.app",
      plugins: [plugin],
      preset,
      projectId: "test.project",
    });

    expect(runtime.commands.get("optional.command")).toBeUndefined();
    await runtime.dispose();
  });

  it("continues runtime cleanup when plugin disposal fails", async () => {
    const events: string[] = [];
    const eventBus = new LocalEventBus<KioskApplicationLifecycleEventMap>();
    eventBus.subscribe("core.app.disposed", () => {
      events.push("disposed");
    });
    const plugin: PluginModule = {
      dispose: () => {
        throw new Error("cleanup failed");
      },
      manifest: {
        id: "project.failing-dispose",
        name: "Failing Dispose",
        type: ["service"],
        version: "1.0.0",
      },
    };
    const preset = createKioskProjectPreset({
      plugins: [plugin.manifest.id],
      requiredNativeCapabilities: [],
      storage: { migrations: [], sqliteRequired: false },
    });
    const runtime = await createKioskApplicationRuntime({
      appId: "test.app",
      plugins: [plugin],
      ports: { eventBus },
      preset,
      projectId: "test.project",
    });

    await expect(runtime.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(events).toEqual(["disposed"]);
  });
});
