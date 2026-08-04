import type {
  PinpadDataPort,
  PinpadPinPort,
  SecurePinInputResult,
  UserInputSourceResult,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import { PinpadInputControl } from "./pinpad-input-control";
import { pinBlockRequest, pinDataRequest, pinEntryRequest } from "./pinpad-input-requests";
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
  XfsPinClientLike,
  XfsPinEventLike,
} from "./types";
import { assertXfsOk, bytesToHex, hResultOf, plainValueFromKeys } from "./utils";
import {
  importXfsWrappedKeySet,
  type XfsWrappedKeySetImportRequest,
  type XfsWrappedKeySetImportResult,
} from "./wrapped-key-set";
import {
  runXfsPinDataCrypt,
  type XfsPinDataCryptRequest,
  type XfsPinDataCryptResult,
} from "./pinpad-crypt";

export type { XfsPinInputFeedback } from "./pinpad-input-control";

export class XfsPinpadDevicePort implements PinpadDataPort, PinpadPinPort {
  private activeInput: PinpadInputControl | undefined;
  private readonly eventSubscription: XfsEventSubscriptionLike | undefined;

  public constructor(private readonly options: XfsDevicePortOptions<XfsPinClientLike>) {
    this.eventSubscription = options.client.subscribeEvent?.((event) => this.onPinEvent(event));
  }

  public async getData(
    options: unknown,
    context?: XfsDeviceOperationContext,
  ): Promise<UserInputSourceResult> {
    const control = this.beginInput(options, context);
    try {
      const result = await this.runInputCommand(context, "get-data", async () => {
        const commandResult = await this.options.client.getData(
          pinDataRequest(options, this.options.session.id, this.options.timeoutMs),
        );
        control.assertCommandResult(commandResult, "pin.getData");
        control.phase = "result";
        return commandResult;
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
    } finally {
      this.endInput(control);
    }
  }

  public async getPin(
    options: unknown,
    context?: XfsDeviceOperationContext,
  ): Promise<SecurePinInputResult> {
    const control = this.beginInput(options, context);
    const request = pinBlockRequest(options, this.options.session.id, this.options.timeoutMs);
    try {
      const result = await this.runInputCommand(context, "get-pin", async () => {
        const entryResult = await this.options.client.getPin(
          pinEntryRequest(options, this.options.session.id, this.options.timeoutMs),
        );
        control.assertCommandResult(entryResult, "pin.getPin");
        control.phase = "result";
        const pinBlockResult = await this.options.client.getPinblock(request);
        assertXfsOk(pinBlockResult, "pin.getPinblock", this.metadata());
        return pinBlockResult;
      });
      const encryptedPinBlock = bytesToHex(result.data) ?? String(result.encryptedPinBlock ?? "");
      if (!encryptedPinBlock) throw missingPinBlock(this.metadata());
      return {
        encryptedPinBlock,
        keyId: typeof request.keyName === "string" ? request.keyName : undefined,
        kind: "securePin",
        pinBlockFormat: typeof request.format === "string" ? request.format : String(request.format),
        safeSummary: {
          hasEncryptedPinBlock: true,
          pinBlockFormat: typeof request.format === "string" ? request.format : String(request.format),
          sourceKind: "pinpad.pin",
        },
        source: {
          deviceId: this.options.deviceId,
          id: context?.operationId ?? this.options.deviceId,
          kind: "pinpad.pin",
        },
      };
    } finally {
      this.endInput(control);
    }
  }

  public async complete(operationId?: string): Promise<void> {
    const control = this.activeInput;
    if (!control || (operationId && control.operationId !== operationId)) {
      throw new FrameworkError({
        category: "dependency",
        code: "xfs.pin.input.noPending",
        message: "No matching XFS PIN input command is pending.",
      });
    }
    control.beginCompletion();
    try {
      await cancelSession(this.options.manager, this.options.session.id);
    } catch (error) {
      control.rollbackCompletion();
      throw error;
    }
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

  public async importWrappedKeySet(
    request: XfsWrappedKeySetImportRequest,
    context?: XfsDeviceOperationContext,
  ): Promise<XfsWrappedKeySetImportResult> {
    const importKey = this.options.client.importKey;
    if (!importKey) {
      throw new FrameworkError({
        category: "dependency",
        code: "xfs.pin.importKey.unavailable",
        message: "The XFS PIN service does not expose wrapped key import.",
        metadata: this.metadata(),
      });
    }
    return runLeasedCommand(
      this.options,
      context,
      "import-wrapped-key-set",
      "maintenance",
      () => importXfsWrappedKeySet(
        { importKey: (input) => importKey.call(this.options.client, input) },
        this.options.session.id,
        this.options.timeoutMs,
        request,
      ),
    );
  }

  public async cryptData(
    request: XfsPinDataCryptRequest,
    context?: XfsDeviceOperationContext,
  ): Promise<XfsPinDataCryptResult> {
    const crypt = this.options.client.crypt;
    if (!crypt) {
      throw new FrameworkError({
        category: "dependency",
        code: "xfs.pin.crypt.unavailable",
        message: "The XFS PIN service does not expose data encryption.",
        metadata: this.metadata(),
      });
    }
    return runLeasedCommand(
      this.options,
      context,
      "crypt-data",
      "transaction",
      () => runXfsPinDataCrypt(
        { crypt: (input) => crypt.call(this.options.client, input) },
        this.options.session.id,
        this.options.timeoutMs,
        request,
      ),
    );
  }

  public async cancel(): Promise<void> {
    await cancelSession(this.options.manager, this.options.session.id);
    await resetDevice(this.options.client, this.options.session, this.options.timeoutMs);
  }

  public dispose(): void {
    this.activeInput = undefined;
    this.eventSubscription?.unsubscribe();
  }

  private beginInput(options: unknown, context?: XfsDeviceOperationContext): PinpadInputControl {
    if (this.activeInput) {
      throw new FrameworkError({
        category: "dependency",
        code: "xfs.pin.input.busy",
        message: "Another XFS PIN input command is already active.",
      });
    }
    const control = new PinpadInputControl(
      context?.operationId ?? this.options.deviceId,
      options,
    );
    this.activeInput = control;
    return control;
  }

  private endInput(control: PinpadInputControl): void {
    if (this.activeInput === control) this.activeInput = undefined;
  }

  private onPinEvent(event: XfsPinEventLike): void {
    this.activeInput?.handle(event);
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
    await runLeasedCommand(this.options, context, `${action}-recovery`, "recovery", async () => {
      await cancelSession(this.options.manager, this.options.session.id).catch(() => undefined);
      await resetDevice(this.options.client, this.options.session, this.options.timeoutMs);
    });
  }

  private metadata(): Record<string, string> {
    return {
      deviceId: this.options.deviceId,
      logicalName: this.options.logicalName,
      module: "pin",
    };
  }
}

const missingPinBlock = (metadata: Record<string, string>): FrameworkError =>
  new FrameworkError({
    category: "native",
    code: "xfs.pinBlock.missing",
    message: "XFS secure PIN input did not return an encrypted PIN block.",
    metadata,
  });
