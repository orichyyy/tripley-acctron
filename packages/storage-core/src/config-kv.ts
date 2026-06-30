import type { JsonValue } from "@tripley/web-container-types";

export type ConfigKvValueType = "string" | "number" | "boolean" | "null" | "array" | "object";

export interface ConfigKvRecord {
  readonly scope: string;
  readonly key: string;
  readonly valueType: ConfigKvValueType;
  readonly valueJson: string;
  readonly schemaId?: string | undefined;
  readonly updatedAt: string;
  readonly updatedBy?: string | undefined;
  readonly reason?: string | undefined;
}

export interface ConfigKvSetOptions {
  readonly schemaId?: string | undefined;
  readonly updatedBy?: string | undefined;
  readonly reason?: string | undefined;
}

export interface ConfigKvStore {
  get<T extends JsonValue = JsonValue>(scope: string, key: string): Promise<T | null>;
  set<T extends JsonValue>(
    scope: string,
    key: string,
    value: T,
    options?: ConfigKvSetOptions,
  ): Promise<ConfigKvRecord>;
  remove(scope: string, key: string): Promise<void>;
}

export const frameworkConfigKvTableSql = `CREATE TABLE IF NOT EXISTS framework_config_kv (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_json TEXT NOT NULL,
  schema_id TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  reason TEXT,
  PRIMARY KEY(scope, key)
);`;

export class InMemoryConfigKvStore implements ConfigKvStore {
  private readonly records = new Map<string, ConfigKvRecord>();

  public async get<T extends JsonValue = JsonValue>(scope: string, key: string): Promise<T | null> {
    const record = this.records.get(configKey(scope, key));
    if (!record) {
      return null;
    }

    const value = JSON.parse(record.valueJson) as JsonValue;
    if (getValueType(value) !== record.valueType) {
      throw new Error(`Config KV value type mismatch for ${scope}:${key}`);
    }

    return value as T;
  }

  public async set<T extends JsonValue>(
    scope: string,
    key: string,
    value: T,
    options: ConfigKvSetOptions = {},
  ): Promise<ConfigKvRecord> {
    const record: ConfigKvRecord = {
      key,
      reason: options.reason,
      schemaId: options.schemaId,
      scope,
      updatedAt: new Date().toISOString(),
      updatedBy: options.updatedBy,
      valueJson: JSON.stringify(value),
      valueType: getValueType(value),
    };
    this.records.set(configKey(scope, key), record);
    return record;
  }

  public async remove(scope: string, key: string): Promise<void> {
    this.records.delete(configKey(scope, key));
  }
}

export const getValueType = (value: JsonValue): ConfigKvValueType => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return type;
  }

  return "object";
};

const configKey = (scope: string, key: string): string => `${scope}:${key}`;
