import {
  type XfsPinBlockRequest,
  XfsPinCompletion,
  XfsPinFormatFromRaw,
  XfsPinFunctionKeyFromRaw,
  type XfsPinGetDataRequest,
  type XfsPinGetPinRequest,
} from "@tripley-kit/xfs-client";
import type {
  PinpadDataPort,
  PinpadPinPort,
  SecurePinInputResult,
  UserInputSourceResult,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import {
  cancelSession,
  resetDevice,
  runLeasedCommand,
  type XfsDevicePortOptions,
} from "./port-command";
import type {
  XfsDeviceOperationContext,
  XfsEventSubscriptionLike,
  XfsNativeEnvelopeLike,
  XfsPinEventLike,
  XfsPinClientLike,
} from "./types";
import { assertXfsOk, bytesToHex, hResultOf, plainValueFromKeys } from "./utils";

export class XfsPinpadDevicePort implements PinpadDataPort, PinpadPinPort {
  private activeFeedback: ActivePinFeedback | undefined;
  private readonly eventSubscription: XfsEventSubscriptionLike | undefined;

  public constructor(private readonly options: XfsDevicePortOptions<XfsPinClientLike>) {
    this.eventSubscription = options.client.subscribeEvent?.((event) => this.onPinEvent(event));
  }

  public async getData(
    options: unknown,
    context?: XfsDeviceOperationContext,
  ): Promise<UserInputSourceResult> {
    const request = this.getDataRequest(options);
    const result = await this.runInputCommand(context, "get-data", async () => {
      const feedback = this.beginFeedback(options);
      try {
        const commandResult = await this.options.client.getData(request);
        assertXfsOk(commandResult, "pin.getData", this.metadata());
        return commandResult;
      } finally {
        this.endFeedback(feedback);
      }
    });

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
    const request = this.getPinBlockRequest(options);
    const result = await this.runInputCommand(context, "get-pin", async () => {
      const feedback = this.beginFeedback(options);
      try {
        const entryResult = await this.options.client.getPin(this.getPinEntryRequest(options));
        assertXfsOk(entryResult, "pin.getPin", this.metadata());
        const pinBlockResult = await this.options.client.getPinblock(request);
        assertXfsOk(pinBlockResult, "pin.getPinblock", this.metadata());
        return pinBlockResult;
      } finally {
        this.endFeedback(feedback);
      }
    });
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
    const result = await runLeasedCommand(
      this.options,
      undefined,
      "status",
      "observation",
      () => this.options.client.getStatus({
        sessionId: this.options.session.id,
        timeoutMs: this.options.timeoutMs,
      }),
    );
    assertXfsOk(result, "pin.getStatus", this.metadata());
    return result;
  }

  public async cancel(): Promise<void> {
    await cancelSession(this.options.manager, this.options.session.id);
    await resetDevice(this.options.client, this.options.session, this.options.timeoutMs);
  }

  public dispose(): void {
    this.activeFeedback = undefined;
    this.eventSubscription?.unsubscribe();
  }

  private async runInputCommand<T extends XfsNativeEnvelopeLike>(
    context: XfsDeviceOperationContext | undefined,
    action: string,
    command: () => Promise<T>,
  ): Promise<T> {
    try {
      return await runLeasedCommand(this.options, context, action, "transaction", command);
    } catch (error) {
      try {
        await this.recoverFailedInput(context, action);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          "XFS PIN input failed and its device session could not be recovered.",
        );
      }
      throw error;
    }
  }

  private async recoverFailedInput(
    context: XfsDeviceOperationContext | undefined,
    action: string,
  ): Promise<void> {
    await runLeasedCommand(
      this.options,
      context,
      `${action}-recovery`,
      "recovery",
      async () => {
        await cancelSession(this.options.manager, this.options.session.id).catch(() => undefined);
        await resetDevice(this.options.client, this.options.session, this.options.timeoutMs);
      },
    );
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

  private beginFeedback(options: unknown): ActivePinFeedback | undefined {
    const input = asRecord(options);
    if (typeof input.onFeedback !== "function") {
      return undefined;
    }
    const feedback: ActivePinFeedback = {
      digitCount: 0,
      maxLength: numberValue(input.maxLength ?? input.maxLen, 12),
      onFeedback: input.onFeedback as PinInputFeedbackHandler,
    };
    this.activeFeedback = feedback;
    emitFeedback(feedback, "started");
    return feedback;
  }

  private endFeedback(feedback: ActivePinFeedback | undefined): void {
    if (feedback && this.activeFeedback === feedback) {
      this.activeFeedback = undefined;
    }
  }

  private onPinEvent(event: XfsPinEventLike): void {
    const feedback = this.activeFeedback;
    const key = pinKeyFromEvent(event);
    if (!feedback || !key) {
      return;
    }
    const completion = key.completion;
    if (completion === XfsPinCompletion.Clear) {
      feedback.digitCount = 0;
      emitFeedback(feedback, "cleared");
      return;
    }
    if (completion === XfsPinCompletion.Backspace) {
      feedback.digitCount = Math.max(0, feedback.digitCount - 1);
      emitFeedback(feedback, "changed");
      return;
    }
    if (completion === XfsPinCompletion.Enter || completion === XfsPinCompletion.Cancel) {
      emitFeedback(feedback, "terminated");
      return;
    }
    if (completion === XfsPinCompletion.Continue) {
      feedback.digitCount = Math.min(feedback.maxLength, feedback.digitCount + 1);
      emitFeedback(feedback, "changed");
    }
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const numberValue = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const pinKeyFromEvent = (
  event: XfsPinEventLike,
): {
  readonly completion?: number | undefined;
  readonly digit?: number | undefined;
} | undefined => {
  if (event.data?.kind !== "key") {
    return undefined;
  }
  const value = asRecord(event.data.value);
  const completion = typeof value.completion === "number" ? value.completion : undefined;
  const digit = typeof value.digit === "number" ? value.digit : undefined;
  return completion === undefined && digit === undefined ? undefined : { completion, digit };
};

export interface XfsPinInputFeedback {
  readonly digitCount: number;
  readonly state: "started" | "changed" | "cleared" | "terminated";
}

type PinInputFeedbackHandler = (feedback: XfsPinInputFeedback) => void;

interface ActivePinFeedback {
  digitCount: number;
  readonly maxLength: number;
  readonly onFeedback: PinInputFeedbackHandler;
}

const emitFeedback = (
  feedback: ActivePinFeedback,
  state: XfsPinInputFeedback["state"],
): void => {
  try {
    feedback.onFeedback({ digitCount: feedback.digitCount, state });
  } catch {
    // Presentation feedback cannot alter secure PIN command control.
  }
};
