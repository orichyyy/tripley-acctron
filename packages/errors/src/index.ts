import type { Metadata } from "@tripley/web-container-types";

export type ErrorSeverity = "debug" | "info" | "warning" | "error" | "fatal";

export type ErrorCategory =
  | "configuration"
  | "dependency"
  | "extension"
  | "native"
  | "plugin"
  | "protocol"
  | "storage"
  | "unknown";

export interface FrameworkErrorOptions {
  readonly category: ErrorCategory;
  readonly cause?: unknown;
  readonly code: string;
  readonly message: string;
  readonly metadata?: Metadata | undefined;
  readonly severity?: ErrorSeverity;
}

export class FrameworkError extends Error {
  public readonly category: ErrorCategory;
  public readonly code: string;
  public readonly metadata: Metadata;
  public readonly severity: ErrorSeverity;

  public constructor(options: FrameworkErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "FrameworkError";
    this.category = options.category;
    this.code = options.code;
    this.metadata = options.metadata ?? {};
    this.severity = options.severity ?? "error";
  }
}

export interface ErrorDescriptor {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly defaultMessage: string;
  readonly severity: ErrorSeverity;
}

export class ErrorCatalog {
  private readonly descriptors = new Map<string, ErrorDescriptor>();

  public register(descriptor: ErrorDescriptor): void {
    if (this.descriptors.has(descriptor.code)) {
      throw new FrameworkError({
        category: "configuration",
        code: "errorCatalog.duplicateCode",
        message: `Error code already registered: ${descriptor.code}`,
        metadata: { code: descriptor.code },
      });
    }

    this.descriptors.set(descriptor.code, descriptor);
  }

  public get(code: string): ErrorDescriptor | undefined {
    return this.descriptors.get(code);
  }

  public create(code: string, message?: string, metadata?: Metadata): FrameworkError {
    const descriptor = this.descriptors.get(code);
    if (!descriptor) {
      return new FrameworkError({
        category: "unknown",
        code,
        message: message ?? `Unknown framework error: ${code}`,
        metadata,
      });
    }

    return new FrameworkError({
      category: descriptor.category,
      code,
      message: message ?? descriptor.defaultMessage,
      metadata,
      severity: descriptor.severity,
    });
  }
}
