import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { JsonValue, Metadata } from "@tripley-kit/web-container-types";

export const loggingPackageName = "@tripley-kit/web-container-logging";

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

export type FrameworkLogData = Readonly<Record<string, unknown>>;

export interface FrameworkLogMetadata {
  readonly eventId: string;
  readonly eventName?: string;
  readonly eventCode?: number;
  readonly module: string;
  readonly action?: string;
  readonly traceId?: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly userId?: string;
  readonly source?: {
    readonly file?: string;
    readonly function?: string;
    readonly line?: number;
  };
  readonly data?: FrameworkLogData;
  readonly [key: string]: unknown;
}

export interface AppLogError {
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: string;
}

export interface AppLogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly metadata?: FrameworkLogMetadata;
  readonly error?: AppLogError;
}

export interface LoggerPort {
  trace(message: string, metadata: FrameworkLogMetadata): void;
  debug(message: string, metadata: FrameworkLogMetadata): void;
  info(message: string, metadata: FrameworkLogMetadata): void;
  warn(message: string, metadata: FrameworkLogMetadata): void;
  error(message: string, error: unknown, metadata: FrameworkLogMetadata): void;
  child(metadata: Partial<FrameworkLogMetadata>): LoggerPort;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export interface RedactionOptions {
  readonly replacement?: string;
  readonly sensitiveKeys?: readonly string[];
}

export const defaultSensitiveLogKeys = [
  "password",
  "token",
  "secret",
  "pin",
  "auth",
  "privateKey",
] as const;

export class LogRedactor {
  private readonly replacement: string;
  private readonly sensitivePatterns: RegExp[];

  public constructor(options: RedactionOptions = {}) {
    this.replacement = options.replacement ?? "[REDACTED]";
    this.sensitivePatterns = (options.sensitiveKeys ?? defaultSensitiveLogKeys).map(
      (key) => new RegExp(key, "i"),
    );
  }

  public redactMetadata(metadata: FrameworkLogMetadata): FrameworkLogMetadata {
    const redacted = this.redactValue(metadata) as Record<string, unknown>;
    if (typeof redacted.userId === "string" && !this.isAllowedUserId(redacted.userId)) {
      redacted.userId = this.replacement;
    }

    return redacted as unknown as FrameworkLogMetadata;
  }

  public redactMetadataObject(metadata: Metadata): Metadata {
    return this.redactValue(metadata) as Metadata;
  }

  private redactValue(value: unknown, key?: string, depth = 0): unknown {
    if (key && this.isSensitiveKey(key)) {
      return this.replacement;
    }

    if (value === null || value === undefined || typeof value !== "object") {
      return value;
    }

    if (depth > 8) {
      return "[MaxDepth]";
    }

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => this.redactValue(item, undefined, depth + 1));
    }

    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        this.redactValue(entryValue, entryKey, depth + 1),
      ]),
    );
  }

  private isSensitiveKey(key: string): boolean {
    return this.sensitivePatterns.some((pattern) => pattern.test(key));
  }

  private isAllowedUserId(userId: string): boolean {
    return userId.startsWith("hashed:") || userId.startsWith("sha256:");
  }
}

export interface ConsoleLogSink {
  trace(record: AppLogRecord): void;
  debug(record: AppLogRecord): void;
  info(record: AppLogRecord): void;
  warn(record: AppLogRecord): void;
  error(record: AppLogRecord): void;
}

export const defaultConsoleLogSink: ConsoleLogSink = {
  trace: (record) => console.trace(JSON.stringify(record)),
  debug: (record) => console.debug(JSON.stringify(record)),
  info: (record) => console.info(JSON.stringify(record)),
  warn: (record) => console.warn(JSON.stringify(record)),
  error: (record) => console.error(JSON.stringify(record)),
};

export interface ConsoleLoggerOptions {
  readonly metadata?: Partial<FrameworkLogMetadata>;
  readonly redactor?: LogRedactor;
  readonly sink?: ConsoleLogSink;
}

export class ConsoleLogger implements LoggerPort {
  private readonly metadata: Partial<FrameworkLogMetadata>;
  private readonly redactor: LogRedactor;
  private readonly sink: ConsoleLogSink;

  public constructor(options: ConsoleLoggerOptions = {}) {
    this.metadata = options.metadata ?? {};
    this.redactor = options.redactor ?? new LogRedactor();
    this.sink = options.sink ?? defaultConsoleLogSink;
  }

  public trace(message: string, metadata: FrameworkLogMetadata): void {
    this.write("TRACE", message, metadata);
  }

  public debug(message: string, metadata: FrameworkLogMetadata): void {
    this.write("DEBUG", message, metadata);
  }

  public info(message: string, metadata: FrameworkLogMetadata): void {
    this.write("INFO", message, metadata);
  }

  public warn(message: string, metadata: FrameworkLogMetadata): void {
    this.write("WARN", message, metadata);
  }

  public error(message: string, error: unknown, metadata: FrameworkLogMetadata): void {
    this.write("ERROR", message, metadata, serializeError(error));
  }

  public child(metadata: Partial<FrameworkLogMetadata>): LoggerPort {
    return new ConsoleLogger({
      metadata: { ...this.metadata, ...metadata },
      redactor: this.redactor,
      sink: this.sink,
    });
  }

  private write(
    level: LogLevel,
    message: string,
    metadata: FrameworkLogMetadata,
    error?: AppLogError,
  ): void {
    const mergedMetadata = enforceLogMetadata({ ...this.metadata, ...metadata });
    const record: AppLogRecord = {
      level,
      message,
      metadata: this.redactor.redactMetadata(mergedMetadata),
      timestamp: new Date().toISOString(),
    };
    const recordWithError = error ? { ...record, error } : record;

    this.sink[level.toLowerCase() as Lowercase<LogLevel>](recordWithError);
  }
}

export interface TripleyKitLoggerBoundary {
  trace?(message: string, metadata?: unknown): void;
  debug?(message: string, metadata?: unknown): void;
  info?(message: string, metadata?: unknown): void;
  warn?(message: string, metadata?: unknown): void;
  error?(message: string, error?: unknown, metadata?: unknown): void;
  child?(metadata: unknown): TripleyKitLoggerBoundary;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export class TripleyKitLoggerAdapter implements LoggerPort {
  private readonly logger: TripleyKitLoggerBoundary;
  private readonly metadata: Partial<FrameworkLogMetadata>;
  private readonly redactor: LogRedactor;

  public constructor(
    logger: TripleyKitLoggerBoundary,
    options: { metadata?: Partial<FrameworkLogMetadata>; redactor?: LogRedactor } = {},
  ) {
    this.logger = logger;
    this.metadata = options.metadata ?? {};
    this.redactor = options.redactor ?? new LogRedactor();
  }

  public trace(message: string, metadata: FrameworkLogMetadata): void {
    this.write("trace", message, metadata);
  }

  public debug(message: string, metadata: FrameworkLogMetadata): void {
    this.write("debug", message, metadata);
  }

  public info(message: string, metadata: FrameworkLogMetadata): void {
    this.write("info", message, metadata);
  }

  public warn(message: string, metadata: FrameworkLogMetadata): void {
    this.write("warn", message, metadata);
  }

  public error(message: string, error: unknown, metadata: FrameworkLogMetadata): void {
    const safeMetadata = this.safeMetadata(metadata);
    if (this.logger.error) {
      this.logger.error(message, error, safeMetadata);
      return;
    }

    this.logger.warn?.(message, { ...safeMetadata, error: serializeError(error) });
  }

  public child(metadata: Partial<FrameworkLogMetadata>): LoggerPort {
    const merged = { ...this.metadata, ...metadata };
    const childLogger = this.logger.child?.(merged) ?? this.logger;
    return new TripleyKitLoggerAdapter(childLogger, {
      metadata: merged,
      redactor: this.redactor,
    });
  }

  public async flush(): Promise<void> {
    await this.logger.flush?.();
  }

  public async close(): Promise<void> {
    await this.logger.close?.();
  }

  private write(
    method: "trace" | "debug" | "info" | "warn",
    message: string,
    metadata: FrameworkLogMetadata,
  ): void {
    this.logger[method]?.(message, this.safeMetadata(metadata));
  }

  private safeMetadata(metadata: FrameworkLogMetadata): FrameworkLogMetadata {
    return this.redactor.redactMetadata(enforceLogMetadata({ ...this.metadata, ...metadata }));
  }
}

export const createConsoleFallbackLogger = (
  reason: string,
  options: ConsoleLoggerOptions = {},
): LoggerPort => {
  const logger = new ConsoleLogger(options);
  logger.warn("Native file logging unavailable; using console fallback", {
    eventId: "logging.file.unavailable",
    module: "logging",
    action: "fallback",
    data: { reason },
  });
  return logger;
};

export const enforceLogMetadata = (
  metadata: Partial<FrameworkLogMetadata>,
): FrameworkLogMetadata => {
  if (!metadata.eventId || typeof metadata.eventId !== "string") {
    throw new FrameworkError({
      category: "configuration",
      code: "logging.metadata.eventIdRequired",
      message: "Framework logs must include metadata.eventId.",
    });
  }

  if (!metadata.module || typeof metadata.module !== "string") {
    throw new FrameworkError({
      category: "configuration",
      code: "logging.metadata.moduleRequired",
      message: "Framework logs must include metadata.module.",
    });
  }

  return metadata as FrameworkLogMetadata;
};

export const serializeError = (error: unknown): AppLogError => {
  if (error instanceof Error) {
    const serialized: AppLogError = {
      message: error.message,
      name: error.name,
    };
    const withStack = error.stack ? { ...serialized, stack: error.stack } : serialized;
    return typeof error.cause === "undefined"
      ? withStack
      : { ...withStack, cause: String(error.cause) };
  }

  return { message: String(error) };
};

export const logMetadataToJson = (metadata: FrameworkLogMetadata): JsonValue =>
  JSON.parse(JSON.stringify(metadata)) as JsonValue;
