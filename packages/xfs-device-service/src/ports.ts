import {
  XfsIdcDataSourceFromRaw,
  XfsIdcEjectPositionFromRaw,
  type XfsPinBlockRequest,
  XfsPinFormatFromRaw,
  XfsPinFunctionKeyFromRaw,
  type XfsPinGetDataRequest,
  type XfsPinGetPinRequest,
} from "@tripley-kit/xfs-client";
import type {
  BarcodeReaderPort,
  InputSourceSession,
  PinpadDataPort,
  PinpadPinPort,
  SecurePinInputResult,
  UserInputSourceResult,
} from "@tripley/web-container-device-core";
import { FrameworkError } from "@tripley/web-container-errors";

import { runAbortableXfsCommand } from "./abortable-command";
import type {
  XfsBcrClientLike,
  XfsCardEjectOptions,
  XfsCardMediaStatus,
  XfsCardReadOptions,
  XfsCardReadResult,
  XfsCardRetainOptions,
  XfsCardTakenResult,
  XfsDeviceOperationContext,
  XfsIdcClientLike,
  XfsManagerClientLike,
  XfsNativeEnvelopeLike,
  XfsPinClientLike,
  XfsSessionLike,
  XfsSessionRequestLike,
  XfsWaitForCardTakenOptions,
} from "./types";
import { assertXfsOk, bytesToHex, bytesToText, hResultOf, plainValueFromKeys } from "./utils";

interface XfsDevicePortOptions<TClient> {
  readonly client: TClient;
  readonly deviceId: string;
  readonly logicalName: string;
  readonly manager: XfsManagerClientLike;
  readonly session: XfsSessionLike;
  readonly timeoutMs: number;
}

export interface XfsCardReaderPort {
  readCard(
    options?: XfsCardReadOptions,
    context?: XfsDeviceOperationContext,
  ): Promise<XfsCardReadResult>;
  ejectCard(options?: XfsCardEjectOptions, context?: XfsDeviceOperationContext): Promise<void>;
  retainCard(options?: XfsCardRetainOptions, context?: XfsDeviceOperationContext): Promise<void>;
  getMediaStatus(): Promise<XfsCardMediaStatus>;
  waitForTaken(
    options?: XfsWaitForCardTakenOptions,
    context?: XfsDeviceOperationContext,
  ): Promise<XfsCardTakenResult>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}

export class XfsCardReaderDevicePort implements XfsCardReaderPort {
  public constructor(private readonly options: XfsDevicePortOptions<XfsIdcClientLike>) {}

  public async readCard(
    options: XfsCardReadOptions = {},
    context?: XfsDeviceOperationContext,
  ): Promise<XfsCardReadResult> {
    const result = await runAbortableXfsCommand({
      cancel: () => cancelSession(this.options.manager, this.options.session.id),
      execute: () => this.options.client.readRawData({
        dataSources: XfsIdcDataSourceFromRaw(options.dataSources ?? 0xffff),
        sessionId: this.options.session.id,
        timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
      }),
      signal: context?.signal,
    });
    assertXfsOk(result, "idc.readRawData", this.metadata());
    return {
      kind: "card",
      raw: result,
      safeSummary: {
        deviceId: this.options.deviceId,
        hResult: hResultOf(result),
        logicalName: this.options.logicalName,
        sourceKind: "cardReader.track",
      },
    };
  }

  public async ejectCard(options: XfsCardEjectOptions = {}): Promise<void> {
    if (!this.options.client.ejectCard) {
      throw missingCardCapability("ejectCard", this.metadata());
    }
    const result = await this.options.client.ejectCard({
      ...(options.position
        ? { ejectPosition: XfsIdcEjectPositionFromRaw(options.position === "exit" ? 1 : 2) }
        : {}),
      sessionId: this.options.session.id,
      timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
    });
    assertXfsOk(result, "idc.ejectCard", this.metadata());
  }

  public async retainCard(options: XfsCardRetainOptions = {}): Promise<void> {
    if (!this.options.client.retainCard) {
      throw missingCardCapability("retainCard", this.metadata());
    }
    const result = await this.options.client.retainCard({
      sessionId: this.options.session.id,
      timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
    });
    assertXfsOk(result, "idc.retainCard", this.metadata());
  }

  public async getMediaStatus(): Promise<XfsCardMediaStatus> {
    const result = await this.options.client.getStatus({
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    });
    assertXfsOk(result, "idc.getStatus", this.metadata());
    const state = cardMediaState(result.fwMedia);
    return {
      state,
      safeSummary: {
        deviceId: this.options.deviceId,
        logicalName: this.options.logicalName,
        mediaState: state,
      },
    };
  }

  public async waitForTaken(
    options: XfsWaitForCardTakenOptions = {},
    context?: XfsDeviceOperationContext,
  ): Promise<XfsCardTakenResult> {
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs;
    const pollIntervalMs = options.pollIntervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;
    let status = await this.getMediaStatus();
    while (status.state !== "notPresent" && Date.now() < deadline) {
      if (context?.signal?.aborted) {
        throw new FrameworkError({
          category: "dependency",
          code: "xfs.card.waitForTaken.cancelled",
          message: "Waiting for card removal was cancelled.",
          metadata: this.metadata(),
        });
      }
      await delay(pollIntervalMs, context?.signal);
      status = await this.getMediaStatus();
    }
    return {
      taken: status.state === "notPresent",
      status,
      safeSummary: { mediaState: status.state, taken: status.state === "notPresent" },
    };
  }

  public async cancel(): Promise<void> {
    await cancelSession(this.options.manager, this.options.session.id);
    await resetDevice(this.options.client, this.options.session, this.options.timeoutMs);
  }

  private metadata(): Record<string, string> {
    return {
      deviceId: this.options.deviceId,
      logicalName: this.options.logicalName,
      module: "idc",
    };
  }
}

export class XfsPinpadDevicePort implements PinpadDataPort, PinpadPinPort {
  public constructor(private readonly options: XfsDevicePortOptions<XfsPinClientLike>) {}

  public async getData(
    options: unknown,
    context?: XfsDeviceOperationContext,
  ): Promise<UserInputSourceResult> {
    const request = this.getDataRequest(options);
    const result = await this.options.client.getData(request);
    assertXfsOk(result, "pin.getData", this.metadata());

    return {
      kind: "plain",
      safeSummary: {
        deviceId: this.options.deviceId,
        hResult: hResultOf(result),
        sourceKind: "pinpad.data",
      },
      source: {
        deviceId: this.options.deviceId,
        id: context?.operationId ?? this.options.deviceId,
        kind: "pinpad.data",
      },
      value: plainValueFromKeys(result.keys) ?? String(result.value ?? ""),
    };
  }

  public async getPin(
    options: unknown,
    context?: XfsDeviceOperationContext,
  ): Promise<SecurePinInputResult> {
    const entryResult = await this.options.client.getPin(this.getPinEntryRequest(options));
    assertXfsOk(entryResult, "pin.getPin", this.metadata());

    const request = this.getPinBlockRequest(options);
    const result = await this.options.client.getPinblock(request);
    assertXfsOk(result, "pin.getPinblock", this.metadata());
    const encryptedPinBlock = bytesToHex(result.data) ?? String(result.encryptedPinBlock ?? "");
    if (!encryptedPinBlock) {
      throw new FrameworkError({
        category: "native",
        code: "xfs.pinBlock.missing",
        message: "XFS secure PIN input did not return an encrypted PIN block.",
        metadata: this.metadata(),
      });
    }

    return {
      encryptedPinBlock,
      keyId: typeof request.keyName === "string" ? request.keyName : undefined,
      kind: "securePin",
      pinBlockFormat: typeof request.format === "string" ? request.format : String(request.format),
      safeSummary: {
        hasEncryptedPinBlock: true,
        pinBlockFormat:
          typeof request.format === "string" ? request.format : String(request.format),
        sourceKind: "pinpad.pin",
      },
      source: {
        deviceId: this.options.deviceId,
        id: context?.operationId ?? this.options.deviceId,
        kind: "pinpad.pin",
      },
    };
  }

  public async getStatus(): Promise<unknown> {
    const result = await this.options.client.getStatus({
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    });
    assertXfsOk(result, "pin.getStatus", this.metadata());
    return result;
  }

  public async cancel(): Promise<void> {
    await cancelSession(this.options.manager, this.options.session.id);
    await resetDevice(this.options.client, this.options.session, this.options.timeoutMs);
  }

  private getDataRequest(options: unknown): XfsPinGetDataRequest {
    const input = asRecord(options);
    return {
      activeFdks: numberValue(input.activeFdks, 0),
      activeKeys: XfsPinFunctionKeyFromRaw(numberValue(input.activeKeys, 0xffff)),
      autoEnd: booleanValue(input.autoEnd, true),
      maxLen: numberValue(input.maxLength ?? input.maxLen, 12),
      sessionId: this.options.session.id,
      terminateFdks: numberValue(input.terminateFdks, 0),
      terminateKeys: XfsPinFunctionKeyFromRaw(numberValue(input.terminateKeys, 0)),
      timeoutMs: numberValue(input.timeoutMs, this.options.timeoutMs),
    };
  }

  private getPinBlockRequest(options: unknown): XfsPinBlockRequest {
    const input = asRecord(options);
    return {
      ...(stringValue(input.customerData) ? { customerData: stringValue(input.customerData) } : {}),
      format: XfsPinFormatFromRaw(numberValue(input.format ?? input.pinBlockFormat, 2)),
      ...(stringValue(input.keyEncKeyName)
        ? { keyEncKeyName: stringValue(input.keyEncKeyName) }
        : {}),
      ...(stringValue(input.keyName ?? input.keySlot)
        ? { keyName: stringValue(input.keyName ?? input.keySlot) }
        : {}),
      padding: numberValue(input.padding, 0),
      sessionId: this.options.session.id,
      timeoutMs: numberValue(input.timeoutMs, this.options.timeoutMs),
      ...(stringValue(input.xorData) ? { xorData: stringValue(input.xorData) } : {}),
    };
  }

  private getPinEntryRequest(options: unknown): XfsPinGetPinRequest {
    const input = asRecord(options);
    return {
      activeFdks: numberValue(input.activeFdks, 0),
      activeKeys: XfsPinFunctionKeyFromRaw(numberValue(input.activeKeys, 0x03ff)),
      autoEnd: booleanValue(input.autoEnd, true),
      echo: numberValue(input.echo, 0),
      maxLen: numberValue(input.maxLength ?? input.maxLen, 12),
      minLen: numberValue(input.minLength ?? input.minLen, 4),
      sessionId: this.options.session.id,
      terminateFdks: numberValue(input.terminateFdks, 0),
      terminateKeys: XfsPinFunctionKeyFromRaw(numberValue(input.terminateKeys, 0x0400)),
      timeoutMs: numberValue(input.timeoutMs, this.options.timeoutMs),
    };
  }

  private metadata(): Record<string, string> {
    return {
      deviceId: this.options.deviceId,
      logicalName: this.options.logicalName,
      module: "pin",
    };
  }
}

export class XfsBarcodeReaderDevicePort implements BarcodeReaderPort {
  public constructor(private readonly options: XfsDevicePortOptions<XfsBcrClientLike>) {}

  public async startScan(
    options: unknown,
    context?: XfsDeviceOperationContext,
  ): Promise<InputSourceSession<UserInputSourceResult>> {
    const operationId = context?.operationId ?? `${this.options.deviceId}.scan`;
    const result = this.readQr(options, operationId);
    return {
      cancel: () => this.stopScan(operationId),
      id: operationId,
      result,
      sourceId: operationId,
      sourceKind: "barcodeReader.qr",
    };
  }

  public async stopScan(_operationId?: string, _reason?: string): Promise<void> {
    await cancelSession(this.options.manager, this.options.session.id);
  }

  public async getStatus(): Promise<unknown> {
    const result = await this.options.client.getStatus({
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    });
    assertXfsOk(result, "bcr.getStatus", this.metadata());
    return result;
  }

  private async readQr(options: unknown, operationId: string): Promise<UserInputSourceResult> {
    const input = asRecord(options);
    const result = await this.options.client.read({
      sessionId: this.options.session.id,
      symbologies: input.symbologies instanceof Uint8Array ? input.symbologies : new Uint8Array(),
      timeoutMs: numberValue(input.timeoutMs, this.options.timeoutMs),
    });
    assertXfsOk(result, "bcr.read", this.metadata());
    const output = Array.isArray(result.outputs) ? result.outputs[0] : undefined;
    const barcodeData =
      output && typeof output === "object"
        ? (output as Record<string, unknown>).barcodeData
        : undefined;

    return {
      kind: "plain",
      safeSummary: {
        deviceId: this.options.deviceId,
        hResult: hResultOf(result),
        sourceKind: "barcodeReader.qr",
        symbologyName:
          output && typeof output === "object"
            ? (output as Record<string, unknown>).symbologyName
            : undefined,
      },
      source: {
        deviceId: this.options.deviceId,
        id: operationId,
        kind: "barcodeReader.qr",
      },
      value: bytesToText(barcodeData) ?? bytesToHex(barcodeData),
    };
  }

  private metadata(): Record<string, string> {
    return {
      deviceId: this.options.deviceId,
      logicalName: this.options.logicalName,
      module: "bcr",
    };
  }
}

const cancelSession = async (manager: XfsManagerClientLike, sessionId: string): Promise<void> => {
  await manager.cancelAsyncRequest({ requestId: 0, sessionId });
};

const resetDevice = async (
  client: { reset?(request: XfsSessionRequestLike): Promise<XfsNativeEnvelopeLike> },
  session: XfsSessionLike,
  timeoutMs: number,
): Promise<void> => {
  if (!client.reset) {
    return;
  }

  const result = await client.reset({ sessionId: session.id, timeoutMs });
  assertXfsOk(result, "device.reset");
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const numberValue = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const cardMediaState = (value: unknown): XfsCardMediaStatus["state"] => {
  if (value === 1) {
    return "presented";
  }
  if (value === 2) {
    return "notPresent";
  }
  if (value === 3) {
    return "jammed";
  }
  if (value === 4) {
    return "unsupported";
  }
  if (value === 6 || value === 7) {
    return "inside";
  }
  return "unknown";
};

const missingCardCapability = (
  capability: string,
  metadata: Record<string, string>,
): FrameworkError =>
  new FrameworkError({
    category: "dependency",
    code: "xfs.card.capabilityUnavailable",
    message: `XFS card capability is unavailable: ${capability}`,
    metadata: { ...metadata, capability },
  });

const delay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(
          new FrameworkError({
            category: "dependency",
            code: "xfs.card.waitForTaken.cancelled",
            message: "Waiting for card removal was cancelled.",
          }),
        );
      },
      { once: true },
    );
  });
