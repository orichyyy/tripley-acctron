import { FrameworkError } from "@tripley-kit/web-container-errors";

import type {
  CashRecoveryDevicePort,
  CashRecoveryDeviceRegistrationPort,
  CashRecoveryDeviceRegistryPort,
  CashRecoveryLeaseRecord,
  CashRecoveryObservation,
} from "./recovery-contracts";
import type {
  XfsCdmClientLike,
  XfsSessionLike,
} from "./types";
import { captureCdmInventorySnapshot } from "./cash-inventory-snapshot";
import { assertXfsOk } from "./utils";

export class CashRecoveryDeviceRegistry
  implements CashRecoveryDeviceRegistryPort, CashRecoveryDeviceRegistrationPort {
  private readonly devices = new Map<string, CashRecoveryDevicePort>();

  public register(logicalService: string, device: CashRecoveryDevicePort): void {
    if (this.devices.has(logicalService)) {
      throw recoveryDeviceError(
        "cash.recoveryDevice.duplicate",
        `Cash recovery device is already registered: ${logicalService}`,
        logicalService,
      );
    }
    this.devices.set(logicalService, device);
  }

  public unregister(logicalService: string, device: CashRecoveryDevicePort): void {
    if (this.devices.get(logicalService) === device) {
      this.devices.delete(logicalService);
    }
  }

  public require(logicalService: string): CashRecoveryDevicePort {
    const device = this.devices.get(logicalService);
    if (!device) {
      throw recoveryDeviceError(
        "cash.recoveryDevice.missing",
        `Cash recovery device is not registered: ${logicalService}`,
        logicalService,
      );
    }
    return device;
  }
}

export interface XfsCdmCashRecoveryDeviceOptions {
  readonly client: XfsCdmClientLike;
  readonly configurationRevision: string;
  readonly idFactory?: (() => string) | undefined;
  readonly logicalService: string;
  readonly now?: (() => Date) | undefined;
  readonly outputPosition: number;
  readonly retractArea: number;
  readonly retractIndex: number;
  readonly session: XfsSessionLike;
  readonly timeoutMs: number;
}

export class XfsCdmCashRecoveryDevice implements CashRecoveryDevicePort {
  public constructor(private readonly options: XfsCdmCashRecoveryDeviceOptions) {}

  public captureAfterSnapshot(
    record: CashRecoveryLeaseRecord,
  ): Promise<import("./cash-contracts").CashInventorySnapshot> {
    this.requireLogicalService(record);
    return captureCdmInventorySnapshot(
      {
        client: this.options.client,
        dependencies: {
          ...(this.options.now ? { now: this.options.now } : {}),
        },
        logicalName: this.options.logicalService,
        policy: {
          configurationRevision: this.options.configurationRevision,
        },
        session: this.options.session,
        timeoutMs: this.options.timeoutMs,
      },
      record.operationId,
      record.cashSessionId,
      "after",
      this.options.idFactory?.() ?? defaultId(),
    );
  }

  public async observe(record: CashRecoveryLeaseRecord): Promise<CashRecoveryObservation> {
    this.requireLogicalService(record);
    const request = {
      position: this.options.outputPosition,
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    };
    const [present, status] = await Promise.all([
      this.options.client.getPresentStatus(request),
      this.options.client.getStatus({
        sessionId: this.options.session.id,
        timeoutMs: this.options.timeoutMs,
      }),
    ]);
    assertXfsOk(present, "cdm.getPresentStatus", this.metadata());
    assertXfsOk(status, "cdm.getStatus", this.metadata());

    const output = status.positions?.find(
      ({ fwPosition }) => fwPosition === this.options.outputPosition,
    );
    if (present.presentState === WFS_CDM_PRESENTED) {
      return {
        state: output?.fwPositionStatus === WFS_CDM_PSEMPTY ? "taken" : "presented",
      };
    }
    if (present.presentState === WFS_CDM_NOTPRESENTED) {
      if (
        status.fwIntermediateStacker === WFS_CDM_ISNOTEMPTY ||
        record.phase === "staged"
      ) {
        return { state: "staged" };
      }
      if (record.phase === "planning") {
        return { state: "notDispensed" };
      }
    }
    return { state: "unknown" };
  }

  public async retract(record: CashRecoveryLeaseRecord): Promise<CashRecoveryObservation> {
    this.requireLogicalService(record);
    const result = await this.options.client.retract({
      retract: {
        index: this.options.retractIndex,
        outputPosition: this.options.outputPosition,
        retractArea: this.options.retractArea,
      },
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    });
    assertXfsOk(result, "cdm.retract", this.metadata());
    return { state: "retracted" };
  }

  private requireLogicalService(record: CashRecoveryLeaseRecord): void {
    if (record.logicalService !== this.options.logicalService) {
      throw recoveryDeviceError(
        "cash.recoveryDevice.logicalServiceMismatch",
        "Cash recovery record targets a different logical service.",
        record.logicalService,
      );
    }
  }

  private metadata(): Record<string, string> {
    return {
      logicalService: this.options.logicalService,
      module: "cdm",
    };
  }
}

const recoveryDeviceError = (
  code: string,
  message: string,
  logicalService: string,
): FrameworkError =>
  new FrameworkError({
    category: "configuration",
    code,
    message,
    metadata: { logicalService },
  });

const WFS_CDM_PSEMPTY = 0;
const WFS_CDM_ISNOTEMPTY = 1;
const WFS_CDM_PRESENTED = 1;
const WFS_CDM_NOTPRESENTED = 2;

const defaultId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `cash-recovery-${Date.now()}-${Math.random()}`;
