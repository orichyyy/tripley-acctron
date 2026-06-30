# 09. Configuration System

## Purpose

Spring/.NET Core-like configuration with multiple providers, ordered override, schema validation, watch/reload, writable runtime config, and extensible providers.

## Decisions

- Default priority: CLI > env > SQLite > JSON > defaults.
- Project can customize provider order.
- Admin runtime changes default to SQLite.
- Dot path and colon path both supported; internally normalized.
- Supports reload + watch; publishes `core.config.changed`.
- Zod / JSON Schema adapters; validation at startup and save.
- Secret config supports redaction and records Native Secure Storage requirement.
- Scopes: framework, project, device, plugin, runtime, window, user.

## Provider contract

```ts
export interface ConfigurationProvider {
  id: string;
  readonly: boolean;
  load(): Promise<ConfigurationObject>;
  watch?(onChanged: (change: ConfigurationChange) => void): ConfigurationSubscription;
  dispose?(): Promise<void>;
}

export interface WritableConfigurationProvider extends ConfigurationProvider {
  readonly: false;
  set<T = unknown>(key: string, value: T, options?: ConfigurationSetOptions): Promise<void>;
  remove(key: string, options?: ConfigurationSetOptions): Promise<void>;
  save?(): Promise<void>;
}
```

## Configuration API

```ts
export interface Configuration {
  get<T = unknown>(key: string): T | undefined;
  getOrThrow<T = unknown>(key: string): T;
  getSection<T = ConfigurationObject>(key: string): T;
  set<T = unknown>(key: string, value: T, options?: ConfigurationWriteOptions): Promise<void>;
  remove(key: string, options?: ConfigurationWriteOptions): Promise<void>;
  reload(): Promise<void>;
  watch(key: string, handler: ConfigurationChangeHandler): ConfigurationSubscription;
}
```

## Default providers

```text
CommandLineConfigurationProvider
EnvironmentConfigurationProvider
SqliteConfigurationProvider
JsonFileConfigurationProvider
InMemoryConfigurationProvider
```

Extensible providers:

```text
YamlConfigurationProvider
XmlConfigurationProvider
RemoteConfigurationProvider
EncryptedConfigurationProvider
```

## SQLite KV table

```sql
CREATE TABLE IF NOT EXISTS framework_config_kv (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_json TEXT NOT NULL,
  schema_id TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  reason TEXT,
  PRIMARY KEY(scope, key)
);
```

Use `value_json + value_type + schema_id` so typed reads do not require manual conversion.

```ts
const maxAmount = config.getOrThrow<number>('withdrawal.maxAmount');
await config.set('host.ip', '192.168.10.20', { scope: 'device', provider: 'sqlite', reason: 'admin-updated-host-ip' });
```

## Config changed event

```text
core.config.changed
```

Payload contains scope, key, provider, old summary, new summary, updatedBy, reason.
