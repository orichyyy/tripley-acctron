import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { Metadata } from "@tripley-kit/web-container-types";
import type { Disposable, Subscription } from "@tripley-kit/web-container-utils";

export const nativeAdapterPackageName = "@tripley-kit/web-container-native-adapter";

export interface RuntimeInfo {
  readonly name?: string;
  readonly version?: string;
  readonly platform?: string;
  readonly [key: string]: unknown;
}

export type NativeServiceName =
  | "runtime"
  | "fs"
  | "archive"
  | "tcp"
  | "websocket"
  | "sqlite"
  | "system";

export interface FrameworkFileSystemPort {
  call<TResponse = unknown>(method: string, ...args: readonly unknown[]): Promise<TResponse>;
}

export interface FrameworkArchivePort {
  call<TResponse = unknown>(method: string, ...args: readonly unknown[]): Promise<TResponse>;
}

export interface FrameworkTcpPort {
  call<TResponse = unknown>(method: string, ...args: readonly unknown[]): Promise<TResponse>;
}

export interface FrameworkWebSocketPort {
  call<TResponse = unknown>(method: string, ...args: readonly unknown[]): Promise<TResponse>;
}

export interface FrameworkSqlitePort {
  call<TResponse = unknown>(method: string, ...args: readonly unknown[]): Promise<TResponse>;
}

export interface FrameworkSystemPort {
  call<TResponse = unknown>(method: string, ...args: readonly unknown[]): Promise<TResponse>;
}

export interface NativePort extends Disposable {
  readonly fs: FrameworkFileSystemPort;
  readonly archive: FrameworkArchivePort;
  readonly tcp: FrameworkTcpPort;
  readonly websocket: FrameworkWebSocketPort;
  readonly sqlite: FrameworkSqlitePort;
  readonly system: FrameworkSystemPort;
  readonly extensions: NativeExtensionRegistry;
  connect(): Promise<void>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  listCapabilities(): Promise<string[]>;
  requireCapabilities(capabilities: readonly string[]): Promise<void>;
}

export interface NativeReconnectPolicy {
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly backoffMultiplier?: number;
  readonly onReconnectFailed?: "failApp" | "enterMaintenance" | "ignore";
}

export interface NativeExtensionCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly traceId?: string;
}

export interface NativeExtensionEvent {
  readonly extensionId: string;
  readonly topic: string;
  readonly payload: unknown;
  readonly metadata?: Metadata;
}

export interface NativeExtensionAdapter {
  readonly id: string;
  readonly capabilities: readonly string[];
  call<TRequest = unknown, TResponse = unknown>(
    method: string,
    request: TRequest,
    options?: NativeExtensionCallOptions,
  ): Promise<TResponse>;
  onEvent?(handler: (event: NativeExtensionEvent) => void): Subscription;
}

export class NativeExtensionRegistry {
  private readonly extensions = new Map<string, NativeExtensionAdapter>();

  public register(adapter: NativeExtensionAdapter): void {
    if (this.extensions.has(adapter.id)) {
      throw new FrameworkError({
        category: "native",
        code: "native.extension.duplicate",
        message: `Native extension already registered: ${adapter.id}`,
        metadata: { extensionId: adapter.id },
      });
    }

    this.extensions.set(adapter.id, adapter);
  }

  public get(id: string): NativeExtensionAdapter | undefined {
    return this.extensions.get(id);
  }

  public require(id: string): NativeExtensionAdapter {
    const extension = this.extensions.get(id);
    if (!extension) {
      throw new FrameworkError({
        category: "native",
        code: "native.extension.missing",
        message: `Native extension is not registered: ${id}`,
        metadata: { extensionId: id },
      });
    }

    return extension;
  }

  public findByCapability(capability: string): NativeExtensionAdapter | undefined {
    return [...this.extensions.values()].find((extension) =>
      extension.capabilities.includes(capability),
    );
  }

  public list(): NativeExtensionAdapter[] {
    return [...this.extensions.values()];
  }
}

export interface NativeCapabilityStatus {
  readonly capability: string;
  readonly available: boolean;
  readonly level: "service" | "method" | "feature";
  readonly reason?: string;
}

export interface TripleyNativeAdapterOptions {
  readonly extensions?: NativeExtensionRegistry;
  readonly reconnectPolicy?: NativeReconnectPolicy;
}

export class TripleyNativeAdapter implements NativePort {
  public readonly archive: FrameworkArchivePort;
  public readonly extensions: NativeExtensionRegistry;
  public readonly fs: FrameworkFileSystemPort;
  public readonly sqlite: FrameworkSqlitePort;
  public readonly system: FrameworkSystemPort;
  public readonly tcp: FrameworkTcpPort;
  public readonly websocket: FrameworkWebSocketPort;

  private readonly native: NativeSdkShape;
  private readonly reconnectPolicy: NativeReconnectPolicy | undefined;

  public constructor(native: unknown, options: TripleyNativeAdapterOptions = {}) {
    this.native = assertNativeSdkShape(native);
    this.extensions = options.extensions ?? new NativeExtensionRegistry();
    this.reconnectPolicy = options.reconnectPolicy;
    this.fs = createServicePort("fs", this.native.fs);
    this.archive = createServicePort("archive", this.native.archive);
    this.tcp = createServicePort("tcp", this.native.tcp);
    this.websocket = createServicePort("websocket", this.native.websocket);
    this.sqlite = createServicePort("sqlite", this.native.sqlite);
    this.system = createServicePort("system", this.native.system);
  }

  public async connect(): Promise<void> {
    await this.native.connect();
  }

  public async dispose(): Promise<void> {
    await this.native.dispose();
  }

  public async getRuntimeInfo(): Promise<RuntimeInfo> {
    return this.native.runtime.getInfo();
  }

  public async listCapabilities(): Promise<string[]> {
    const nativeCapabilities = await this.native.runtime.listCapabilities();
    const extensionCapabilities = this.extensions
      .list()
      .flatMap((extension) => [...extension.capabilities]);
    return [...new Set([...nativeCapabilities, ...extensionCapabilities])];
  }

  public async requireCapabilities(capabilities: readonly string[]): Promise<void> {
    const statuses = await Promise.all(
      capabilities.map((capability) => this.checkCapability(capability)),
    );
    const missing = statuses.filter((status) => !status.available);

    if (missing.length > 0) {
      throw new FrameworkError({
        category: "native",
        code: "native.capability.missing",
        message: `Missing required native capabilities: ${missing
          .map((status) => status.capability)
          .join(", ")}`,
        metadata: {
          missingCapabilities: missing.map((status) => ({
            capability: status.capability,
            level: status.level,
            reason: status.reason ?? "unavailable",
          })),
        },
        severity: "fatal",
      });
    }
  }

  public getReconnectPolicy(): NativeReconnectPolicy | undefined {
    return this.reconnectPolicy;
  }

  public async checkCapability(capability: string): Promise<NativeCapabilityStatus> {
    const listedCapabilities = await this.listCapabilities();
    if (listedCapabilities.includes(capability)) {
      return { available: true, capability, level: inferCapabilityLevel(capability) };
    }

    const [serviceName, methodName] = capability.split(".");
    if (!serviceName) {
      return {
        available: false,
        capability,
        level: "feature",
        reason: "Capability name is empty.",
      };
    }

    const service = this.native[serviceName];
    if (!service) {
      return {
        available: false,
        capability,
        level: "service",
        reason: `Native service is missing: ${serviceName}`,
      };
    }

    if (!methodName) {
      return { available: true, capability, level: "service" };
    }

    const method = (service as Record<string, unknown>)[methodName];
    if (typeof method !== "function") {
      return {
        available: false,
        capability,
        level: "method",
        reason: `Native method is missing: ${serviceName}.${methodName}`,
      };
    }

    return {
      available: false,
      capability,
      level: "feature",
      reason: "Method exists, but runtime.listCapabilities did not advertise the feature.",
    };
  }
}

const inferCapabilityLevel = (capability: string): NativeCapabilityStatus["level"] => {
  const segments = capability.split(".");
  if (segments.length === 1) {
    return "service";
  }

  if (segments.length === 2) {
    return "method";
  }

  return "feature";
};

const createServicePort = (serviceName: string, service: unknown): FrameworkFileSystemPort => ({
  call: async <TResponse = unknown>(
    method: string,
    ...args: readonly unknown[]
  ): Promise<TResponse> => {
    const target = assertRecord(service, `Native service is missing: ${serviceName}`);
    const candidate = target[method];
    if (typeof candidate !== "function") {
      throw new FrameworkError({
        category: "native",
        code: "native.method.missing",
        message: `Native method is missing: ${serviceName}.${method}`,
        metadata: { method, serviceName },
      });
    }

    return candidate.apply(service, args) as Promise<TResponse>;
  },
});

interface NativeRuntimeShape {
  getInfo(): Promise<RuntimeInfo>;
  listCapabilities(): Promise<string[]>;
}

type NativeSdkShape = {
  readonly connect: () => Promise<void>;
  readonly dispose: () => Promise<void>;
  readonly runtime: NativeRuntimeShape;
  readonly [key: string]: unknown;
};

const assertNativeSdkShape = (native: unknown): NativeSdkShape => {
  const record = assertRecord(native, "Native SDK object is required.");
  const runtime = assertRecord(record.runtime, "Native runtime service is required.");
  if (
    typeof record.connect !== "function" ||
    typeof record.dispose !== "function" ||
    typeof runtime.getInfo !== "function" ||
    typeof runtime.listCapabilities !== "function"
  ) {
    throw new FrameworkError({
      category: "native",
      code: "native.sdk.invalid",
      message:
        "Native SDK must provide connect, dispose, runtime.getInfo, and runtime.listCapabilities.",
    });
  }

  return record as NativeSdkShape;
};

const assertRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    throw new FrameworkError({
      category: "native",
      code: "native.sdk.invalid",
      message,
    });
  }

  return value as Record<string, unknown>;
};
