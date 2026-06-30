import { describe, expect, it } from "vitest";
import {
  CommandLineConfigurationProvider,
  ConfigurationManager,
  EnvironmentConfigurationProvider,
  InMemoryConfigurationProvider,
  JsonFileConfigurationProvider,
  SqliteConfigurationProvider,
  deserializeSqliteConfigValue,
  loadMergedProviders,
  normalizeConfigurationPath,
  sqliteConfigKvSchemaSql,
} from "./index";
import type { ConfigurationValidationResult, SqliteConfigKvRow } from "./index";

describe("configuration path handling", () => {
  it("normalizes dot and colon paths", () => {
    expect(normalizeConfigurationPath(" host:ip ")).toBe("host.ip");
    expect(normalizeConfigurationPath("host..port")).toBe("host.port");
  });

  it("rejects empty paths", () => {
    expect(() => normalizeConfigurationPath(" : ")).toThrow("Configuration path");
  });
});

describe("configuration providers", () => {
  it("merges providers using precedence order", async () => {
    const merged = await loadMergedProviders([
      new CommandLineConfigurationProvider("cli", ["--host.ip=10.0.0.3"]),
      new EnvironmentConfigurationProvider("env", { APP_host__ip: "10.0.0.2" }, "APP_"),
      new JsonFileConfigurationProvider("json", () => ({ host: { ip: "10.0.0.1", port: 443 } })),
    ]);

    expect(merged).toEqual({ host: { ip: "10.0.0.3", port: 443 } });
  });
});

describe("ConfigurationManager", () => {
  it("gets, sets, removes, and watches normalized keys", async () => {
    const provider = new InMemoryConfigurationProvider("memory", { host: { ip: "10.0.0.1" } });
    const manager = new ConfigurationManager({ providers: [provider] });
    const changes: string[] = [];
    manager.watch("host", (change) => changes.push(change.key));

    await manager.reload();
    expect(manager.get("host:ip")).toBe("10.0.0.1");

    await manager.set("host:port", 443, { reason: "test" });
    expect(manager.get("host.port")).toBe(443);

    await manager.remove("host.port");
    expect(manager.get("host.port")).toBeUndefined();
    expect(changes).toEqual(["host.port", "host.port"]);
  });

  it("runs schema validation on reload and set", async () => {
    const invalid: ConfigurationValidationResult = {
      issues: [{ message: "required", path: "host.ip" }],
      ok: false,
    };
    const manager = new ConfigurationManager({
      providers: [new InMemoryConfigurationProvider("memory", {})],
      validators: [
        {
          id: "test-schema",
          validate: async () => ({ ok: true }),
          validateValue: async (key) => (key === "host.ip" ? invalid : { ok: true }),
        },
      ],
    });

    await manager.reload();
    await expect(manager.set("host.ip", "")).rejects.toMatchObject({
      code: "configuration.value.validation.failed",
    });
  });

  it("fails writes when the selected provider is readonly", async () => {
    const manager = new ConfigurationManager({
      providers: [new JsonFileConfigurationProvider("json", () => ({ host: { ip: "10.0.0.1" } }))],
    });

    await expect(manager.set("host.ip", "10.0.0.2", { provider: "json" })).rejects.toMatchObject({
      code: "configuration.provider.notWritable",
    });
  });
});

describe("SQLite configuration contracts", () => {
  it("defines the expected KV table schema", () => {
    expect(sqliteConfigKvSchemaSql).toContain("CREATE TABLE IF NOT EXISTS framework_config_kv");
    expect(sqliteConfigKvSchemaSql).toContain("value_json TEXT NOT NULL");
    expect(sqliteConfigKvSchemaSql).toContain("PRIMARY KEY(scope, key)");
  });

  it("loads and writes typed KV rows", async () => {
    const rows: SqliteConfigKvRow[] = [
      {
        key: "host.ip",
        scope: "device",
        updated_at: "2026-06-30T00:00:00.000Z",
        value_json: '"10.0.0.1"',
        value_type: "string",
      },
    ];
    const provider = new SqliteConfigurationProvider("sqlite", {
      loadRows: async () => rows,
      removeRow: async (_scope, key) => {
        rows.splice(
          rows.findIndex((row) => row.key === key),
          1,
        );
      },
      setRow: async (row) => {
        rows.push(row);
      },
    });

    expect(await provider.load()).toEqual({ host: { ip: "10.0.0.1" } });
    await provider.set("host.port", 443, { reason: "admin", scope: "device" });

    expect(rows.at(-1)).toMatchObject({
      key: "host.port",
      reason: "admin",
      value_json: "443",
      value_type: "number",
    });
  });

  it("rejects SQLite rows with mismatched value types", () => {
    expect(() =>
      deserializeSqliteConfigValue({
        key: "host.port",
        scope: "device",
        updated_at: "2026-06-30T00:00:00.000Z",
        value_json: '"443"',
        value_type: "number",
      }),
    ).toThrow("value type mismatch");
  });
});
