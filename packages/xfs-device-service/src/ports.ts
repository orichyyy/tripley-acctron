import {
  XfsIdcDataSourceFromRaw,
  XfsIdcEjectPositionFromRaw,
} from "@tripley-kit/xfs-client";
import type {
  BarcodeReaderPort,
  InputSourceSession,
  UserInputSourceResult,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import { runAbortableXfsCommand } from "./abortable-command";
import {
  cancelSession,
  resetDevice,
  runLeasedCommand,
  type XfsDevicePortOptions,
} from "./port-command";
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
  XfsWaitForCardTakenOptions,
} from "./types";
import { assertXfsOk, bytesToHex, bytesToText, hResultOf } from "./utils";

export { XfsPinpadDevicePort } from "./pinpad-device-port";

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
  private mediaRemovedSequence = 0;
  private takeEvidenceBaseline = 0;

  public constructor(private readonly options: XfsDevicePortOptions<XfsIdcClientLike>) {
    options.client.subscribeEvent?.((event) => {
      if (event.data?.kind === "mediaRemoved") this.mediaRemovedSequence += 1;
    });
  }

  public async readCard(
    options: XfsCardReadOptions = {},
    context?: XfsDeviceOperationContext,
  ): Promise<XfsCardReadResult> {
    const result = await runLeasedCommand(this.options, context, "read-card", "transaction", () =>
      runAbortableXfsCommand({
      cancel: () => cancelSession(this.options.manager, this.options.session.id),
      execute: async () => {
        if (this.options.resetBeforeRead) {
          await resetDevice(
            this.options.client,
            this.options.session,
            options.timeoutMs ?? this.options.timeoutMs,
          );
        }
        return this.options.client.readRawData({
          dataSources: XfsIdcDataSourceFromRaw(options.dataSources ?? 0xffff),
          sessionId: this.options.session.id,
          timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
        });
      },
      signal: context?.signal,
    }));
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

  public async ejectCard(
    options: XfsCardEjectOptions = {},
    context?: XfsDeviceOperationContext,
  ): Promise<void> {
    if (!this.options.client.ejectCard) {
      throw missingCardCapability("ejectCard", this.metadata());
    }
    this.takeEvidenceBaseline = this.mediaRemovedSequence;
    const result = await runLeasedCommand(this.options, context, "eject-card", "transaction", () =>
      runAbortableXfsCommand({
      cancel: () => cancelSession(this.options.manager, this.options.session.id),
      execute: () => this.options.client.ejectCard!({
        ...(options.position
          ? { ejectPosition: XfsIdcEjectPositionFromRaw(options.position === "exit" ? 1 : 2) }
          : {}),
        sessionId: this.options.session.id,
        timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
      }),
      signal: context?.signal,
    }));
    assertXfsOk(result, "idc.ejectCard", this.metadata());
  }

  public async retainCard(
    options: XfsCardRetainOptions = {},
    context?: XfsDeviceOperationContext,
  ): Promise<void> {
    if (!this.options.client.retainCard) {
      throw missingCardCapability("retainCard", this.metadata());
    }
    const result = await runLeasedCommand(this.options, context, "retain-card", "transaction", () =>
      runAbortableXfsCommand({
      cancel: () => cancelSession(this.options.manager, this.options.session.id),
      execute: () => this.options.client.retainCard!({
        sessionId: this.options.session.id,
        timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
      }),
      signal: context?.signal,
    }));
    assertXfsOk(result, "idc.retainCard", this.metadata());
  }

  public async getMediaStatus(): Promise<XfsCardMediaStatus> {
    const result = await runLeasedCommand(this.options, undefined, "media-status", "observation", () =>
      this.options.client.getStatus({
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    }));
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
    while (this.mediaRemovedSequence <= this.takeEvidenceBaseline && Date.now() < deadline) {
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
      taken: this.mediaRemovedSequence > this.takeEvidenceBaseline,
      status,
      safeSummary: {
        mediaState: status.state,
        taken: this.mediaRemovedSequence > this.takeEvidenceBaseline,
        takenEvidence: this.mediaRemovedSequence > this.takeEvidenceBaseline
          ? "mediaRemovedEvent"
          : "none",
      },
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
    const result = await runLeasedCommand(this.options, undefined, "status", "observation", () =>
      this.options.client.getStatus({
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    }));
    assertXfsOk(result, "bcr.getStatus", this.metadata());
    return result;
  }

  private async readQr(options: unknown, operationId: string): Promise<UserInputSourceResult> {
    const input = asRecord(options);
    const result = await runLeasedCommand(
      this.options,
      { operationId },
      "read-qr",
      "transaction",
      () => this.options.client.read({
      sessionId: this.options.session.id,
      symbologies: input.symbologies instanceof Uint8Array ? input.symbologies : new Uint8Array(),
      timeoutMs: numberValue(input.timeoutMs, this.options.timeoutMs),
    }));
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const numberValue = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

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
