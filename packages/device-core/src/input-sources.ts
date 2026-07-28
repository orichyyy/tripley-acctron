import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { MaybePromise } from "@tripley-kit/web-container-types";

import type { DeviceRegistry } from "./devices";
import type { DataClassification } from "./devices";
import type { ExtensionRegistration } from "./extension-registry";
import { GenericExtensionRegistry } from "./extension-registry";
import type { DeviceLockManager } from "./locks";
import {
  createReplayableInputSourceProgress,
  type InputSourceProgressStream,
  type ReplayableInputSourceProgress,
} from "./input-progress";

export type InputSourceKind =
  | "pinpad.data"
  | "pinpad.pin"
  | "barcodeReader.qr"
  | "cardReader.card"
  | "ui.command"
  | (string & {});

export interface InputSourceExecutionContext {
  readonly flowId: string;
  readonly flowVersion: string;
  readonly instanceId: string;
  readonly nodeId: string;
  readonly traceId?: string | undefined;
  readonly devices: DeviceRegistry;
  readonly deviceLocks: DeviceLockManager;
  readonly signal?: AbortSignal | undefined;
}

export interface UserInputSourceDefinition<TOptions = unknown> {
  readonly id: string;
  readonly kind: InputSourceKind;
  readonly deviceId?: string | undefined;
  readonly required?: boolean | undefined;
  readonly enabledWhen?:
    | boolean
    | string
    | ((ctx: InputSourceExecutionContext) => MaybePromise<boolean>)
    | undefined;
  readonly options?: TOptions | undefined;
  readonly secure?: boolean | undefined;
  readonly dataClassification?: DataClassification | undefined;
}

export interface UserInputSourceResult<TValue = unknown> {
  readonly kind: string;
  readonly value?: TValue | undefined;
  readonly source: {
    readonly id: string;
    readonly kind: string;
    readonly deviceId?: string | undefined;
  };
  readonly safeSummary?: Record<string, unknown> | undefined;
}

export interface SecurePinInputResult {
  readonly kind: "securePin";
  readonly encryptedPinBlock: string;
  readonly ksn?: string | undefined;
  readonly keyId?: string | undefined;
  readonly pinBlockFormat?: string | undefined;
  readonly source: {
    readonly id: string;
    readonly kind: "pinpad.pin";
    readonly deviceId?: string | undefined;
  };
  readonly safeSummary: {
    readonly sourceKind: "pinpad.pin";
    readonly hasEncryptedPinBlock: true;
    readonly pinBlockFormat?: string | undefined;
  };
}

export interface InputSourceSession<TResult extends UserInputSourceResult = UserInputSourceResult> {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceKind: string;
  readonly result: Promise<TResult>;
  readonly progress?: InputSourceProgressStream | undefined;
  cancel(reason?: string): Promise<void>;
}

export interface InputSourceAdapter<
  TOptions = unknown,
  TResult extends UserInputSourceResult = UserInputSourceResult,
> {
  readonly kind: InputSourceKind;
  readonly contractVersion?: string | undefined;
  readonly dataClassification?: DataClassification | undefined;
  validateDefinition?(source: UserInputSourceDefinition<TOptions>): MaybePromise<void>;
  canStart(
    ctx: InputSourceExecutionContext,
    source: UserInputSourceDefinition<TOptions>,
  ): MaybePromise<boolean>;
  start(
    ctx: InputSourceExecutionContext,
    source: UserInputSourceDefinition<TOptions>,
  ): Promise<InputSourceSession<TResult>>;
}

export class InputSourceRegistry {
  private readonly adapters = new GenericExtensionRegistry<InputSourceAdapter>("inputSources");

  public register<TAdapter extends InputSourceAdapter>(
    adapterOrRegistration: TAdapter | ExtensionRegistration<TAdapter>,
  ): void {
    if (isExtensionRegistration(adapterOrRegistration)) {
      this.adapters.register(adapterOrRegistration as ExtensionRegistration<InputSourceAdapter>);
      return;
    }

    this.adapters.register({
      id: adapterOrRegistration.kind,
      value: adapterOrRegistration,
    });
  }

  public get(kind: InputSourceKind): InputSourceAdapter | undefined {
    return this.adapters.get(kind);
  }

  public require(kind: InputSourceKind): InputSourceAdapter {
    return this.adapters.require(kind);
  }

  public has(kind: InputSourceKind): boolean {
    return this.adapters.has(kind);
  }

  public list(): readonly ExtensionRegistration<InputSourceAdapter>[] {
    return this.adapters.list();
  }
}

export interface DeviceOperationAdapterOptions<
  TPort,
  TOptions,
  TResult extends UserInputSourceResult,
> {
  readonly kind: InputSourceKind;
  readonly defaultDeviceId?: string | undefined;
  readonly dataClassification?: DataClassification | undefined;
  readonly start: (
    port: TPort,
    source: UserInputSourceDefinition<TOptions>,
    ctx: InputSourceExecutionContext,
  ) => Promise<InputSourceSession<TResult>>;
}

export const createDeviceOperationInputSourceAdapter = <
  TPort,
  TOptions = unknown,
  TResult extends UserInputSourceResult = UserInputSourceResult,
>(
  options: DeviceOperationAdapterOptions<TPort, TOptions, TResult>,
): InputSourceAdapter<TOptions, TResult> => ({
  kind: options.kind,
  dataClassification: options.dataClassification,
  canStart: (ctx, source) =>
    ctx.devices.has(source.deviceId ?? options.defaultDeviceId ?? source.id),
  start: async (ctx, source) => {
    const deviceId = source.deviceId ?? options.defaultDeviceId ?? source.id;
    const port = ctx.devices.require<TPort>(deviceId);
    return options.start(port, { ...source, deviceId }, ctx);
  },
});

export const registerBuiltInInputSourceAdapters = (
  registry: InputSourceRegistry,
  adapters: readonly InputSourceAdapter[],
): void => {
  for (const adapter of adapters) {
    registry.register(adapter);
  }
};

export interface PinpadDataPort {
  getData(
    options: unknown,
    context?: { readonly operationId: string; readonly signal?: AbortSignal | undefined },
  ): Promise<UserInputSourceResult>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}

export interface PinpadPinPort {
  getPin(
    options: unknown,
    context?: { readonly operationId: string; readonly signal?: AbortSignal | undefined },
  ): Promise<SecurePinInputResult>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}

export interface BarcodeReaderPort {
  startScan(
    options: unknown,
    context?: { readonly operationId: string; readonly signal?: AbortSignal | undefined },
  ): Promise<InputSourceSession<UserInputSourceResult>>;
  stopScan(operationId?: string, reason?: string): Promise<void>;
}

export const createPinpadDataInputSourceAdapter = (
  defaultDeviceId = "pinpad",
): InputSourceAdapter => ({
  kind: "pinpad.data",
  dataClassification: "sensitive",
  canStart: (ctx, source) => ctx.devices.has(source.deviceId ?? defaultDeviceId),
  start: async (ctx, source) => {
    const deviceId = source.deviceId ?? defaultDeviceId;
    const port = ctx.devices.require<PinpadDataPort>(deviceId);
    const operationId = `${ctx.instanceId}.${ctx.nodeId}.${source.id}`;
    const progress = createReplayableInputSourceProgress();
    return {
      id: operationId,
      sourceId: source.id,
      sourceKind: source.kind,
      progress,
      result: settleProgress(
        port.getData(pinpadProgressOptions(source.options, progress), {
          operationId,
          signal: ctx.signal,
        }),
        progress,
      ),
      cancel: async (reason) => {
        progress.close();
        await port.cancel(operationId, reason);
      },
    };
  },
});

export const createPinpadPinInputSourceAdapter = (
  defaultDeviceId = "pinpad",
): InputSourceAdapter<unknown, SecurePinInputResult> => ({
  kind: "pinpad.pin",
  dataClassification: "secret",
  canStart: (ctx, source) => ctx.devices.has(source.deviceId ?? defaultDeviceId),
  start: async (ctx, source) => {
    const deviceId = source.deviceId ?? defaultDeviceId;
    const port = ctx.devices.require<PinpadPinPort>(deviceId);
    const operationId = `${ctx.instanceId}.${ctx.nodeId}.${source.id}`;
    const progress = createReplayableInputSourceProgress();
    return {
      id: operationId,
      sourceId: source.id,
      sourceKind: source.kind,
      progress,
      result: settleProgress(
        port.getPin(pinpadProgressOptions(source.options, progress), {
          operationId,
          signal: ctx.signal,
        }),
        progress,
      ),
      cancel: async (reason) => {
        progress.close();
        await port.cancel(operationId, reason);
      },
    };
  },
});

export const createBarcodeQrInputSourceAdapter = (
  defaultDeviceId = "barcodeReader",
): InputSourceAdapter => ({
  kind: "barcodeReader.qr",
  dataClassification: "sensitive",
  canStart: (ctx, source) => ctx.devices.has(source.deviceId ?? defaultDeviceId),
  start: async (ctx, source) => {
    const deviceId = source.deviceId ?? defaultDeviceId;
    const port = ctx.devices.require<BarcodeReaderPort>(deviceId);
    return port.startScan(source.options, {
      operationId: `${ctx.instanceId}.${ctx.nodeId}.${source.id}`,
      signal: ctx.signal,
    });
  },
});

const isExtensionRegistration = <TAdapter extends InputSourceAdapter>(
  value: TAdapter | ExtensionRegistration<TAdapter>,
): value is ExtensionRegistration<TAdapter> => {
  if (!("value" in value)) {
    return false;
  }

  if (!value.value || typeof value.value !== "object") {
    throw new FrameworkError({
      category: "configuration",
      code: "inputSource.registration.invalid",
      message: "Input source registration must contain an adapter value.",
    });
  }

  return true;
};

interface PinpadSafeFeedback {
  readonly digitCount: number;
  readonly state: "started" | "changed" | "cleared" | "terminated";
}

const pinpadProgressOptions = (
  options: unknown,
  progress: ReplayableInputSourceProgress,
): Record<string, unknown> => {
  const input = isRecord(options) ? options : {};
  const existing =
    typeof input.onFeedback === "function"
      ? (input.onFeedback as (feedback: PinpadSafeFeedback) => void)
      : undefined;
  return {
    ...input,
    onFeedback: (feedback: PinpadSafeFeedback) => {
      existing?.(feedback);
      progress.publish({
        activity: feedback.state !== "started",
        kind: "pinpad.digitCount",
        safeSummary: {
          digitCount: feedback.digitCount,
          state: feedback.state,
        },
      });
    },
  };
};

const settleProgress = async <T>(
  result: Promise<T>,
  progress: ReplayableInputSourceProgress,
): Promise<T> => {
  try {
    return await result;
  } finally {
    progress.close();
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
