import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { JsonValue, Metadata } from "@tripley-kit/web-container-types";
import {
  BasicSubscription,
  type Clock,
  type Subscription,
  systemClock,
} from "@tripley-kit/web-container-utils";

export const configurationPackageName = "@tripley-kit/web-container-configuration";

export const CONFIGURATION_CHANGED_EVENT = "core.config.changed";

export type ConfigurationObject = Record<string, unknown>;

export type ConfigurationScope =
  | "framework"
  | "project"
  | "device"
  | "plugin"
  | "runtime"
  | "window"
  | "user";

export interface ConfigurationChange {
  readonly key: string;
  readonly provider: string;
  readonly scope?: ConfigurationScope | undefined;
  readonly oldSummary?: JsonValue | undefined;
  readonly newSummary?: JsonValue | undefined;
  readonly updatedBy?: string | undefined;
  readonly reason?: string | undefined;
}

export type ConfigurationChangeHandler = (change: ConfigurationChange) => void;

export type ConfigurationSubscription = Subscription;

export interface ConfigurationSetOptions {
  readonly key?: string;
  readonly reason?: string;
  readonly schemaId?: string;
  readonly scope?: ConfigurationScope;
  readonly updatedBy?: string;
}

export interface ConfigurationWriteOptions extends ConfigurationSetOptions {
  readonly provider?: string;
}

export interface ConfigurationProvider {
  readonly id: string;
  readonly readonly: boolean;
  load(): Promise<ConfigurationObject>;
  watch?(onChanged: (change: ConfigurationChange) => void): ConfigurationSubscription;
  dispose?(): Promise<void>;
}

export interface WritableConfigurationProvider extends ConfigurationProvider {
  readonly readonly: false;
  set<T = unknown>(key: string, value: T, options?: ConfigurationSetOptions): Promise<void>;
  remove(key: string, options?: ConfigurationSetOptions): Promise<void>;
  save?(): Promise<void>;
}

export interface Configuration {
  get<T = unknown>(key: string): T | undefined;
  getOrThrow<T = unknown>(key: string): T;
  getSection<T = ConfigurationObject>(key: string): T;
  set<T = unknown>(key: string, value: T, options?: ConfigurationWriteOptions): Promise<void>;
  remove(key: string, options?: ConfigurationWriteOptions): Promise<void>;
  reload(): Promise<void>;
  watch(key: string, handler: ConfigurationChangeHandler): ConfigurationSubscription;
}

export interface ConfigurationValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly code?: string;
}

export interface ConfigurationValidationResult {
  readonly ok: boolean;
  readonly issues?: readonly ConfigurationValidationIssue[];
}

export interface ConfigurationSchemaValidator {
  readonly id: string;
  validate(configuration: ConfigurationObject): Promise<ConfigurationValidationResult>;
  validateValue?(
    key: string,
    value: unknown,
    options?: ConfigurationWriteOptions,
  ): Promise<ConfigurationValidationResult>;
}

export interface ConfigurationManagerOptions {
  readonly clock?: Clock;
  readonly providers: readonly ConfigurationProvider[];
  readonly validators?: readonly ConfigurationSchemaValidator[];
}

export class ConfigurationManager implements Configuration {
  private readonly clock: Clock;
  private readonly providers: readonly ConfigurationProvider[];
  private readonly validators: readonly ConfigurationSchemaValidator[];
  private readonly watchers = new Map<string, Set<ConfigurationChangeHandler>>();
  private current: ConfigurationObject = {};

  public constructor(options: ConfigurationManagerOptions) {
    this.clock = options.clock ?? systemClock;
    this.providers = options.providers;
    this.validators = options.validators ?? [];

    for (const provider of this.providers) {
      provider.watch?.((change) => this.emitChange(normalizeChange(change)));
    }
  }

  public get<T = unknown>(key: string): T | undefined {
    return getAtPath(this.current, normalizeConfigurationPath(key)) as T | undefined;
  }

  public getOrThrow<T = unknown>(key: string): T {
    const value = this.get<T>(key);
    if (value === undefined) {
      throw new FrameworkError({
        category: "configuration",
        code: "configuration.key.missing",
        message: `Configuration key is missing: ${key}`,
        metadata: { key: normalizeConfigurationPath(key) },
      });
    }

    return value;
  }

  public getSection<T = ConfigurationObject>(key: string): T {
    const section = this.get<T>(key);
    if (section === undefined) {
      return {} as T;
    }

    return section;
  }

  public async set<T = unknown>(
    key: string,
    value: T,
    options: ConfigurationWriteOptions = {},
  ): Promise<void> {
    const normalizedKey = normalizeConfigurationPath(key);
    await this.validateValue(normalizedKey, value, options);
    const provider = this.requireWritableProvider(options.provider);
    const oldValue = this.get(normalizedKey);
    await provider.set(normalizedKey, value, { ...options, key: normalizedKey });
    await provider.save?.();
    setAtPath(this.current, normalizedKey, value);
    this.emitChange({
      key: normalizedKey,
      newSummary: summarizeConfigurationValue(value),
      oldSummary: summarizeConfigurationValue(oldValue),
      provider: provider.id,
      reason: options.reason,
      scope: options.scope,
      updatedBy: options.updatedBy,
    });
  }

  public async remove(key: string, options: ConfigurationWriteOptions = {}): Promise<void> {
    const normalizedKey = normalizeConfigurationPath(key);
    const provider = this.requireWritableProvider(options.provider);
    const oldValue = this.get(normalizedKey);
    await provider.remove(normalizedKey, { ...options, key: normalizedKey });
    await provider.save?.();
    removeAtPath(this.current, normalizedKey);
    this.emitChange({
      key: normalizedKey,
      oldSummary: summarizeConfigurationValue(oldValue),
      provider: provider.id,
      reason: options.reason,
      scope: options.scope,
      updatedBy: options.updatedBy,
    });
  }

  public async reload(): Promise<void> {
    const loaded = await loadMergedProviders(this.providers);
    await this.validateConfiguration(loaded);
    this.current = loaded;
  }

  public watch(key: string, handler: ConfigurationChangeHandler): ConfigurationSubscription {
    const normalizedKey = normalizeConfigurationPath(key);
    const handlers = this.watchers.get(normalizedKey) ?? new Set<ConfigurationChangeHandler>();
    handlers.add(handler);
    this.watchers.set(normalizedKey, handlers);

    return new BasicSubscription(() => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.watchers.delete(normalizedKey);
      }
    });
  }

  public getUpdatedAt(): Date {
    return this.clock.now();
  }

  private requireWritableProvider(id?: string): WritableConfigurationProvider {
    const provider = id
      ? this.providers.find((candidate) => candidate.id === id)
      : this.providers.find(
          (candidate): candidate is WritableConfigurationProvider => !candidate.readonly,
        );

    if (!provider || provider.readonly) {
      throw new FrameworkError({
        category: "configuration",
        code: "configuration.provider.notWritable",
        message: id
          ? `Configuration provider is not writable: ${id}`
          : "No writable configuration provider is available.",
        metadata: id ? { provider: id } : {},
      });
    }

    return provider as WritableConfigurationProvider;
  }

  private async validateConfiguration(configuration: ConfigurationObject): Promise<void> {
    for (const validator of this.validators) {
      const result = await validator.validate(configuration);
      if (!result.ok) {
        throw validationError("configuration.validation.failed", result.issues ?? [], {
          validatorId: validator.id,
        });
      }
    }
  }

  private async validateValue(
    key: string,
    value: unknown,
    options: ConfigurationWriteOptions,
  ): Promise<void> {
    for (const validator of this.validators) {
      const result = await validator.validateValue?.(key, value, options);
      if (result && !result.ok) {
        throw validationError("configuration.value.validation.failed", result.issues ?? [], {
          key,
          validatorId: validator.id,
        });
      }
    }
  }

  private emitChange(change: ConfigurationChange): void {
    for (const [key, handlers] of this.watchers) {
      if (change.key === key || change.key.startsWith(`${key}.`)) {
        for (const handler of handlers) {
          handler(change);
        }
      }
    }
  }
}

export class InMemoryConfigurationProvider implements WritableConfigurationProvider {
  public readonly readonly = false;
  private readonly values: ConfigurationObject;

  public constructor(
    public readonly id: string,
    initialValues: ConfigurationObject = {},
  ) {
    this.values = deepClone(initialValues);
  }

  public async load(): Promise<ConfigurationObject> {
    return deepClone(this.values);
  }

  public async set<T = unknown>(key: string, value: T): Promise<void> {
    setAtPath(this.values, normalizeConfigurationPath(key), value);
  }

  public async remove(key: string): Promise<void> {
    removeAtPath(this.values, normalizeConfigurationPath(key));
  }
}

export class CommandLineConfigurationProvider implements ConfigurationProvider {
  public readonly readonly = true;

  public constructor(
    public readonly id: string,
    private readonly args: readonly string[],
  ) {}

  public async load(): Promise<ConfigurationObject> {
    const values: ConfigurationObject = {};
    for (let index = 0; index < this.args.length; index += 1) {
      const arg = this.args[index];
      if (!arg?.startsWith("--")) {
        continue;
      }

      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
      if (!rawKey) {
        continue;
      }

      const nextArg = this.args[index + 1];
      const value = inlineValue ?? (nextArg && !nextArg.startsWith("--") ? nextArg : "true");
      if (inlineValue === undefined && nextArg && !nextArg.startsWith("--")) {
        index += 1;
      }

      setAtPath(values, normalizeConfigurationPath(rawKey), parseConfigScalar(value));
    }

    return values;
  }
}

export class EnvironmentConfigurationProvider implements ConfigurationProvider {
  public readonly readonly = true;

  public constructor(
    public readonly id: string,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly prefix = "",
  ) {}

  public async load(): Promise<ConfigurationObject> {
    const values: ConfigurationObject = {};
    for (const [envKey, value] of Object.entries(this.env)) {
      if (value === undefined || (this.prefix && !envKey.startsWith(this.prefix))) {
        continue;
      }

      const key = envKey.slice(this.prefix.length).replaceAll("__", ":").replaceAll("_", ".");
      setAtPath(values, normalizeConfigurationPath(key), parseConfigScalar(value));
    }

    return values;
  }
}

export type JsonConfigurationLoader = () => Promise<ConfigurationObject> | ConfigurationObject;

export class JsonFileConfigurationProvider implements ConfigurationProvider {
  public readonly readonly = true;

  public constructor(
    public readonly id: string,
    private readonly loadJson: JsonConfigurationLoader,
  ) {}

  public async load(): Promise<ConfigurationObject> {
    return deepClone(await this.loadJson());
  }
}

export interface SqliteConfigKvRow {
  readonly scope: ConfigurationScope;
  readonly key: string;
  readonly value_type: ConfigurationValueType;
  readonly value_json: string;
  readonly schema_id?: string | null;
  readonly updated_at: string;
  readonly updated_by?: string | null;
  readonly reason?: string | null;
}

export type ConfigurationValueType = "string" | "number" | "boolean" | "null" | "array" | "object";

export const sqliteConfigKvTableName = "framework_config_kv";

export const sqliteConfigKvSchemaSql = `CREATE TABLE IF NOT EXISTS framework_config_kv (
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

export interface SqliteConfigurationStore {
  loadRows(): Promise<readonly SqliteConfigKvRow[]>;
  setRow(row: SqliteConfigKvRow): Promise<void>;
  removeRow(scope: ConfigurationScope, key: string): Promise<void>;
}

export class SqliteConfigurationProvider implements WritableConfigurationProvider {
  public readonly readonly = false;

  public constructor(
    public readonly id: string,
    private readonly store: SqliteConfigurationStore,
    private readonly defaultScope: ConfigurationScope = "device",
    private readonly clock: Clock = systemClock,
  ) {}

  public async load(): Promise<ConfigurationObject> {
    const values: ConfigurationObject = {};
    for (const row of await this.store.loadRows()) {
      setAtPath(values, normalizeConfigurationPath(row.key), deserializeSqliteConfigValue(row));
    }

    return values;
  }

  public async set<T = unknown>(
    key: string,
    value: T,
    options: ConfigurationSetOptions = {},
  ): Promise<void> {
    await this.store.setRow({
      key: normalizeConfigurationPath(key),
      reason: options.reason ?? null,
      schema_id: options.schemaId ?? null,
      scope: options.scope ?? this.defaultScope,
      updated_at: this.clock.now().toISOString(),
      updated_by: options.updatedBy ?? null,
      value_json: JSON.stringify(value),
      value_type: getConfigurationValueType(value),
    });
  }

  public async remove(key: string, options: ConfigurationSetOptions = {}): Promise<void> {
    await this.store.removeRow(options.scope ?? this.defaultScope, normalizeConfigurationPath(key));
  }
}

export const normalizeConfigurationPath = (key: string): string => {
  const normalized = key
    .trim()
    .replaceAll(":", ".")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(".");

  if (!normalized) {
    throw new FrameworkError({
      category: "configuration",
      code: "configuration.path.invalid",
      message: "Configuration path must contain at least one segment.",
    });
  }

  return normalized;
};

export const loadMergedProviders = async (
  providersInPrecedenceOrder: readonly ConfigurationProvider[],
): Promise<ConfigurationObject> => {
  const loaded = await Promise.all(providersInPrecedenceOrder.map((provider) => provider.load()));
  return loaded.reduceRight(
    (merged, current) => deepMerge(merged, current),
    {} as ConfigurationObject,
  );
};

export const summarizeConfigurationValue = (value: unknown): JsonValue => {
  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }

  if (typeof value === "object") {
    return { keys: Object.keys(value).sort(), type: "object" };
  }

  return String(value);
};

export const deserializeSqliteConfigValue = (row: SqliteConfigKvRow): unknown => {
  const parsed = JSON.parse(row.value_json) as unknown;
  if (getConfigurationValueType(parsed) !== row.value_type) {
    throw new FrameworkError({
      category: "configuration",
      code: "configuration.sqlite.valueTypeMismatch",
      message: `SQLite configuration value type mismatch for key: ${row.key}`,
      metadata: { expected: row.value_type, key: row.key },
    });
  }

  return parsed;
};

export const getConfigurationValueType = (value: unknown): ConfigurationValueType => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return valueType;
  }

  return "object";
};

const normalizeChange = (change: ConfigurationChange): ConfigurationChange => ({
  ...change,
  key: normalizeConfigurationPath(change.key),
});

const validationError = (
  code: string,
  issues: readonly ConfigurationValidationIssue[],
  metadata: Metadata,
): FrameworkError =>
  new FrameworkError({
    category: "configuration",
    code,
    message: `Configuration validation failed: ${issues.map((issue) => issue.path).join(", ")}`,
    metadata: {
      ...metadata,
      issues: issues.map((issue) => ({
        code: issue.code ?? null,
        message: issue.message,
        path: issue.path,
      })),
    },
  });

const getAtPath = (source: ConfigurationObject, key: string): unknown =>
  normalizeConfigurationPath(key)
    .split(".")
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      return (current as Record<string, unknown>)[segment];
    }, source);

const setAtPath = (target: ConfigurationObject, key: string, value: unknown): void => {
  const segments = normalizeConfigurationPath(key).split(".");
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  const leaf = segments.at(-1);
  if (leaf) {
    cursor[leaf] = value;
  }
};

const removeAtPath = (target: ConfigurationObject, key: string): void => {
  const segments = normalizeConfigurationPath(key).split(".");
  const leaf = segments.at(-1);
  if (!leaf) {
    return;
  }

  const parent = getAtPath(target, segments.slice(0, -1).join(".")) as
    | Record<string, unknown>
    | undefined;
  delete parent?.[leaf];
};

const deepMerge = (
  base: ConfigurationObject,
  override: ConfigurationObject,
): ConfigurationObject => {
  const merged = deepClone(base);
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = deepMerge(existing, value);
      continue;
    }

    merged[key] = deepCloneValue(value);
  }

  return merged;
};

const deepClone = (value: ConfigurationObject): ConfigurationObject =>
  deepCloneValue(value) as ConfigurationObject;

const deepCloneValue = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as unknown;
};

const isPlainObject = (value: unknown): value is ConfigurationObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseConfigScalar = (value: string): unknown => {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  const numeric = Number(value);
  if (value.trim() !== "" && Number.isFinite(numeric)) {
    return numeric;
  }

  return value;
};
