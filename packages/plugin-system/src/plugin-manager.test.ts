import type { LoggerPort } from "@tripley-kit/web-container-logging";
import { describe, expect, it } from "vitest";
import { GenericExtensionRegistry } from "./extension-registry";
import { PluginManager } from "./plugin-manager";
import type { PermissionTraceRecord, PluginModule } from "./plugin-manager";

const createLogger = (): { readonly logger: LoggerPort; readonly warnings: unknown[] } => {
  const warnings: unknown[] = [];
  const logger: LoggerPort = {
    child: () => logger,
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    trace: () => undefined,
    warn: (_message, metadata) => warnings.push(metadata),
  };
  return { logger, warnings };
};

describe("PluginManager", () => {
  it("lets a test plugin register a new input source, flow node kind, and condition", async () => {
    const manager = new PluginManager({ appId: "app", projectId: "project" });
    const plugin: PluginModule = {
      manifest: {
        id: "plugin.bank.id-card",
        name: "Bank ID Card",
        type: ["device", "flow", "condition"],
        version: "1.0.0",
        contributes: {
          conditions: [
            { condition: { evaluate: () => true }, id: "device.idCardReader.available" },
          ],
          flowNodeExecutors: [{ executor: { run: () => "ok" }, kind: "bank.readIdentity" }],
          inputSources: [
            {
              adapter: { start: () => ({ kind: "identity" }) },
              dataClassification: "sensitive",
              kind: "bank.idCardReader.identity",
            },
          ],
        },
      },
    };

    await manager.install(plugin);
    await manager.register(plugin.manifest.id);

    expect(manager.extensions.inputSources.require("bank.idCardReader.identity").kind).toBe(
      "bank.idCardReader.identity",
    );
    expect(manager.extensions.flowNodeExecutors.require("bank.readIdentity").kind).toBe(
      "bank.readIdentity",
    );
    expect(manager.extensions.conditions.require("device.idCardReader.available").id).toBe(
      "device.idCardReader.available",
    );
  });

  it("traces permission declarations as warnings without enforcing them", async () => {
    const traces: PermissionTraceRecord[] = [];
    const { logger, warnings } = createLogger();
    const manager = new PluginManager({
      appId: "app",
      logger,
      permissionTrace: (record) => {
        traces.push(record);
      },
      projectId: "project",
    });
    const plugin: PluginModule = {
      manifest: {
        id: "plugin.permissions",
        name: "Permissions",
        permissions: {
          devices: ["idCardReader"],
          native: ["device.idCardReader"],
        },
        type: ["device"],
        version: "1.0.0",
      },
    };

    await manager.install(plugin);

    expect(traces).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(manager.getState(plugin.manifest.id)).toBe("installed");
  });

  it("fails activation fatally for required plugins", async () => {
    const manager = new PluginManager({ appId: "app", projectId: "project" });
    const plugin: PluginModule = {
      activate: () => {
        throw new Error("boom");
      },
      manifest: {
        id: "plugin.required",
        name: "Required",
        type: ["service"],
        version: "1.0.0",
      },
    };

    await manager.install(plugin);
    await manager.register(plugin.manifest.id);

    await expect(manager.activate(plugin.manifest.id)).rejects.toMatchObject({
      code: "plugin.activate.failed",
      severity: "fatal",
    });
  });

  it("validates required dependency metadata", async () => {
    const manager = new PluginManager({ appId: "app", projectId: "project" });
    const plugin: PluginModule = {
      manifest: {
        dependencies: { required: { "plugin.missing": "^1.0.0" } },
        id: "plugin.consumer",
        name: "Consumer",
        type: ["service"],
        version: "1.0.0",
      },
    };

    await manager.install(plugin);

    await expect(manager.register(plugin.manifest.id)).rejects.toMatchObject({
      code: "plugin.dependency.missing",
    });
  });

  it("injects runtime ports without allowing identity overrides", async () => {
    let received: unknown;
    const commands = { id: "commands" };
    const manager = new PluginManager({
      appId: "app",
      projectId: "project",
      runtimeContext: {
        appId: "invalid",
        commands,
      },
    });
    const plugin: PluginModule = {
      register: (context) => {
        received = context;
      },
      manifest: {
        id: "plugin.context",
        name: "Context",
        type: ["service"],
        version: "1.0.0",
      },
    };

    await manager.install(plugin);
    await manager.register(plugin.manifest.id);

    expect(received).toMatchObject({
      appId: "app",
      commands,
      pluginId: "plugin.context",
      projectId: "project",
    });
  });

  it("removes contributions when an optional plugin cannot activate", async () => {
    const manager = new PluginManager({ appId: "app", projectId: "project" });
    const plugin: PluginModule = {
      activate: () => {
        throw new Error("optional unavailable");
      },
      manifest: {
        contributes: {
          commands: [{ command: { id: "optional.command" }, id: "optional.command" }],
        },
        id: "plugin.optional",
        name: "Optional",
        optional: true,
        type: ["command"],
        version: "1.0.0",
      },
    };

    await manager.install(plugin);
    await manager.register(plugin.manifest.id);
    await manager.activate(plugin.manifest.id);

    expect(manager.getState(plugin.manifest.id)).toBe("deactivated");
    expect(manager.extensions.commands.has("optional.command")).toBe(false);
  });

  it("deactivates an active plugin before disposing it", async () => {
    const calls: string[] = [];
    const manager = new PluginManager({ appId: "app", projectId: "project" });
    const plugin: PluginModule = {
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
        id: "plugin.lifecycle",
        name: "Lifecycle",
        type: ["service"],
        version: "1.0.0",
      },
    };

    await manager.install(plugin);
    await manager.register(plugin.manifest.id);
    await manager.activate(plugin.manifest.id);
    await manager.dispose();

    expect(calls).toEqual(["activate", "deactivate", "dispose"]);
  });

  it("continues disposing plugins after a plugin cleanup failure", async () => {
    const calls: string[] = [];
    const manager = new PluginManager({ appId: "app", projectId: "project" });
    const plugin = (id: string, fail = false): PluginModule => ({
      activate: () => {
        calls.push(`${id}.activate`);
      },
      deactivate: () => {
        calls.push(`${id}.deactivate`);
      },
      dispose: () => {
        calls.push(`${id}.dispose`);
        if (fail) throw new Error(`${id}.failed`);
      },
      manifest: { id, name: id, type: ["service"], version: "1.0.0" },
    });

    await manager.installAll([plugin("plugin.first"), plugin("plugin.second", true)]);
    await manager.registerAll();
    await manager.activateAll();

    await expect(manager.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(calls).toEqual([
      "plugin.first.activate",
      "plugin.second.activate",
      "plugin.second.deactivate",
      "plugin.second.dispose",
      "plugin.first.deactivate",
      "plugin.first.dispose",
    ]);
    expect(manager.getState("plugin.first")).toBe("disposed");
    expect(manager.getState("plugin.second")).toBe("disposed");
  });
});

describe("GenericExtensionRegistry", () => {
  it("keeps extension-facing kinds as open strings and honors duplicate policy", () => {
    const registry = new GenericExtensionRegistry<{ readonly kind: string }>("test");
    registry.register({
      id: "project.custom.kind",
      ownerPluginId: "plugin.a",
      value: { kind: "first" },
    });
    registry.register({
      duplicatePolicy: "replace",
      id: "project.custom.kind",
      ownerPluginId: "plugin.b",
      priority: 10,
      value: { kind: "second" },
    });

    expect(registry.require("project.custom.kind").kind).toBe("second");
  });
});
