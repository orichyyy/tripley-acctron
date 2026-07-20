import { FrameworkError } from "@tripley-kit/web-container-errors";

import type {
  CashOperationEvidence,
  CashRecoveryTransferPort,
  CashRecoveryTransferReceipt,
  OperationEvidenceRecorderPort,
} from "./cash-contracts";
import type {
  CashRecoveryDeviceRegistryPort,
  CashRecoveryHostLeasePort,
  CashRecoveryLeasePatch,
  CashRecoveryLeaseRecord,
  CashRecoveryLeaseStorePort,
  CashRecoveryRunResult,
} from "./recovery-contracts";

export interface CashRecoverySupervisorOptions {
  readonly ownerInstanceId: string;
  readonly store: CashRecoveryLeaseStorePort;
  readonly commandLeases: CashRecoveryHostLeasePort;
  readonly devices: CashRecoveryDeviceRegistryPort;
  readonly evidence: OperationEvidenceRecorderPort;
  readonly commandLeaseTtlMs: number;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
}

export class CashRecoverySupervisor implements CashRecoveryTransferPort {
  private readonly foregroundResourceReleases = new Map<string, () => Promise<void>>();

  public constructor(private readonly options: CashRecoverySupervisorOptions) {}

  public async acceptTransfer(input: Parameters<CashRecoveryTransferPort["acceptTransfer"]>[0])
    : Promise<CashRecoveryTransferReceipt> {
    const current = await this.requireLease(input.lease.id);
    this.requireOwner(current, input.lease.ownerInstanceId);
    const nextToken = current.fencingToken + 1;
    const pending = await this.swap(current, {
      evidenceSequence: input.evidenceSequence,
      pendingFencingToken: nextToken,
      phase: input.phase,
      state: "transferPending",
    });
    this.foregroundResourceReleases.set(pending.id, input.releaseForegroundResources);
    await this.append(pending, "cash.recovery.transferPending", "flow", input.trigger);
    try {
      const binding = await this.options.commandLeases.transition({
        fencingToken: current.fencingToken,
        fromAuthority: "transaction",
        hostEpoch: input.hostCommandLease.hostEpoch,
        logicalService: current.logicalService,
        nextFencingToken: nextToken,
        operationId: current.operationId,
        toAuthority: "recovery",
        ttlMs: this.options.commandLeaseTtlMs,
      });
      const bound = await this.swap(pending, {
        authority: "recovery",
        fencingToken: binding.fencingToken,
        hostEpoch: binding.hostEpoch,
        ownerInstanceId: this.options.ownerInstanceId,
        state: "recoveryBound",
      });
      await this.append(bound, "cash.recovery.bound", "recovery");
      return { fencingToken: bound.fencingToken, leaseId: bound.id, state: "recoveryBound" };
    } catch (error) {
      return { fencingToken: nextToken, leaseId: pending.id, state: "transferPending" };
    }
  }

  public async recover(): Promise<CashRecoveryRunResult> {
    const records = await this.options.store.listUnresolved();
    let recovered = 0;
    let deadlineBreaches = 0;
    let intervention = 0;
    let recovering = 0;
    for (const record of records) {
      if (record.state === "intervention" || record.state === "maintenanceBound") {
        intervention += 1;
        continue;
      }
      const bound = await this.bind(record);
      if (!bound) { recovering += 1; continue; }
      const deadlinePassed = this.now().getTime() >= Date.parse(bound.recoveryDeadlineAt);
      if (deadlinePassed) {
        deadlineBreaches += 1;
        const escalated = await this.swap(bound, {
          interventionReason: "cash.recovery.deadlineBreached",
          state: "intervention",
        });
        await this.append(escalated, "cash.recovery.deadlineBreached", "recovery");
        const outcome = await this.reconcile(escalated, true);
        if (outcome === "intervention") intervention += 1;
        else recovering += 1;
        continue;
      }
      const outcome = await this.reconcile(bound);
      if (outcome === "intervention") intervention += 1;
      else if (outcome === "recovering") recovering += 1;
      else recovered += 1;
    }
    const unresolved = intervention + recovering;
    const status = intervention > 0 ? "intervention" : recovering > 0 ? "recovering" : "ready";
    return {
      deadlineBreaches,
      recovered,
      safeSummary: { deadlineBreaches, recovered, unresolved },
      status,
      unresolved,
    };
  }

  private async bind(record: CashRecoveryLeaseRecord): Promise<CashRecoveryLeaseRecord | null> {
    if (record.state === "recoveryBound" || record.state === "intervention") return record;
    const hostEpoch = await this.options.commandLeases.getHostEpoch();
    const status = await this.options.commandLeases.status(record.logicalService);
    const nextToken = record.pendingFencingToken ?? record.fencingToken + 1;
    if (status?.operationId === record.operationId
      && status.authority === "recovery"
      && status.fencingToken === nextToken) {
      return this.swap(record, {
        authority: "recovery", fencingToken: nextToken, hostEpoch,
        ownerInstanceId: this.options.ownerInstanceId, state: "recoveryBound",
      });
    }
    if (status && status.hostEpoch === hostEpoch && (status.expiresInMs ?? 1) > 0) return null;
    try {
      const lease = await this.options.commandLeases.acquire({
        authority: "recovery", fencingToken: nextToken, hostEpoch,
        logicalService: record.logicalService, operationId: record.operationId,
        ttlMs: this.options.commandLeaseTtlMs,
      });
      return this.swap(record, {
        authority: "recovery", fencingToken: lease.fencingToken, hostEpoch: lease.hostEpoch,
        ownerInstanceId: this.options.ownerInstanceId, state: "recoveryBound",
      });
    } catch {
      return null;
    }
  }

  private async reconcile(
    record: CashRecoveryLeaseRecord,
    retainIntervention = false,
  ): Promise<"recovered" | "recovering" | "intervention"> {
    const device = this.options.devices.require(record.logicalService);
    let observation;
    try {
      observation = await device.observe(record);
      await this.append(record, `cash.recovery.observed.${observation.state}`, "device");
      if (observation.state === "staged" || observation.state === "presented") {
        observation = await device.retract(record);
        await this.append(record, `cash.recovery.retract.${observation.state}`, "device");
      }
    } catch {
      return this.enterIntervention(record, "cash.recovery.observationFailed");
    }
    if (observation.state === "taken" || observation.state === "retracted"
      || observation.state === "notDispensed") {
      if (retainIntervention) {
        await this.swap(record, { outcome: observation.state });
        return "intervention";
      }
      try {
        await this.releaseForegroundResources(record.id);
        await this.options.commandLeases.release({
          fencingToken: record.fencingToken, hostEpoch: record.hostEpoch ?? "",
          logicalService: record.logicalService, operationId: record.operationId,
        });
      } catch {
        return this.enterIntervention(record, "cash.recovery.resourceReleaseFailed");
      }
      await this.swap(record, { outcome: observation.state, state: "closed" });
      return "recovered";
    }
    return this.enterIntervention(record, "cash.custody.unknown");
  }

  private async enterIntervention(
    record: CashRecoveryLeaseRecord,
    reason: string,
  ): Promise<"intervention"> {
    if (record.state !== "intervention") {
      const updated = await this.swap(record, { interventionReason: reason, state: "intervention" });
      await this.append(updated, "cash.recovery.intervention", "recovery");
    }
    return "intervention";
  }

  private async requireLease(id: string): Promise<CashRecoveryLeaseRecord> {
    const record = await this.options.store.get(id);
    if (!record) throw recoveryError("cash.recoveryLease.missing", id);
    return record;
  }

  private requireOwner(record: CashRecoveryLeaseRecord, owner: string): void {
    if (record.ownerInstanceId !== owner || record.state !== "transactionBound") {
      throw recoveryError("cash.recoveryLease.staleOwner", record.id);
    }
  }

  private async swap(
    record: CashRecoveryLeaseRecord,
    patch: CashRecoveryLeasePatch,
  ): Promise<CashRecoveryLeaseRecord> {
    const updated = await this.options.store.compareAndSwap({
      expectedOwnerInstanceId: record.ownerInstanceId,
      expectedRevision: record.revision,
      id: record.id,
      patch,
      updatedAt: this.now().toISOString(),
    });
    if (!updated) throw recoveryError("cash.recoveryLease.fencingConflict", record.id);
    return updated;
  }

  private async append(
    record: CashRecoveryLeaseRecord,
    kind: string,
    source: CashOperationEvidence["source"],
    trigger?: CashOperationEvidence["trigger"],
  ): Promise<void> {
    await this.options.evidence.append({
      cashSessionId: record.cashSessionId,
      certainty: "observed",
      kind,
      monotonicTime: this.options.monotonicNow?.() ?? performance.now(),
      operationId: record.operationId,
      phase: record.phase,
      sequence: record.evidenceSequence + 1,
      source,
      ...(trigger ? { trigger } : {}),
      wallTime: this.now().toISOString(),
    });
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }

  public async releaseForegroundResources(leaseId: string): Promise<void> {
    const release = this.foregroundResourceReleases.get(leaseId);
    if (!release) return;
    await release();
    this.foregroundResourceReleases.delete(leaseId);
  }
}

const recoveryError = (code: string, leaseId: string): FrameworkError => new FrameworkError({
  category: "dependency", code, message: `Cash recovery lease rejected: ${leaseId}`,
  metadata: { leaseId },
});
