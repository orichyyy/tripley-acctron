import { FrameworkError } from "@tripley-kit/web-container-errors";

import type {
  HostProtectionStatus,
  ProtectionRecoveryApplicationPort,
  ProtectionRecoveryBarrierResult,
  ProtectionRecoveryCase,
  ProtectionRecoveryClassification,
  ProtectionRecoveryHostPort,
  ProtectionRecoveryImportedRecord,
  ProtectionRecoveryProjectionPort,
  ProtectionRecoveryResourceGroup,
  ProtectionRecoveryStorePort,
} from "./protection-recovery-contracts";

export type ProtectionRecoveryIdleHostCasePolicy =
  | "requireIntervention"
  | "acknowledgeAfterApplicationReconciliation";

export interface ProtectionRecoveryStartupBarrierOptions {
  readonly host: ProtectionRecoveryHostPort;
  readonly store: ProtectionRecoveryStorePort;
  readonly resourceGroups: readonly ProtectionRecoveryResourceGroup[];
  readonly projections: readonly ProtectionRecoveryProjectionPort[];
  readonly application: ProtectionRecoveryApplicationPort;
  readonly idleHostCasePolicy?: ProtectionRecoveryIdleHostCasePolicy;
  readonly supersededHostCasePolicy?: ProtectionRecoveryIdleHostCasePolicy;
  readonly now?: () => Date;
}

interface GroupResult {
  readonly classification: "ready" | ProtectionRecoveryClassification;
  readonly importedRecords: number;
  readonly acknowledged: boolean;
}

const terminalOutcomes = new Set([
  "taken",
  "retracted",
  "committed",
  "notMoved",
  "notAccepted",
  "retained",
]);

export class ProtectionRecoveryStartupBarrier {
  private readonly groups: readonly ProtectionRecoveryResourceGroup[];
  private readonly projections: readonly ProtectionRecoveryProjectionPort[];

  public constructor(private readonly options: ProtectionRecoveryStartupBarrierOptions) {
    this.groups = validateIdentities(options.resourceGroups, "resource group");
    this.projections = validateIdentities(options.projections, "projection");
    if (this.groups.length === 0)
      throw configurationError("At least one resource group is required.");
    if (this.projections.length === 0)
      throw configurationError("At least one projection is required.");
  }

  public async recover(): Promise<ProtectionRecoveryBarrierResult> {
    let hostEpoch: string;
    try {
      hostEpoch = await this.options.host.getHostEpoch();
    } catch {
      return summary("recovering", this.groups.length, 0, 0, 0, 0, false);
    }
    if (!hostEpoch) throw configurationError("Tripley Native Host returned an empty host epoch.");

    const results: GroupResult[] = [];
    let failedGroups = 0;
    for (const group of this.groups) {
      try {
        results.push(await this.recoverGroup(group, hostEpoch));
      } catch {
        failedGroups += 1;
      }
    }
    const interventions = results.filter((item) => item.classification === "intervention").length;
    const recovering = results.filter((item) => item.classification === "recovering").length;
    const status =
      interventions > 0
        ? "intervention"
        : recovering > 0 || failedGroups > 0
          ? "recovering"
          : "ready";
    return summary(
      status,
      recovering,
      interventions,
      failedGroups,
      results.reduce((count, item) => count + item.importedRecords, 0),
      results.filter((item) => item.acknowledged).length,
      true,
    );
  }

  private async recoverGroup(
    group: ProtectionRecoveryResourceGroup,
    hostEpoch: string,
  ): Promise<GroupResult> {
    const status = await this.options.host.protectionStatus(group.id);
    if (status.resourceGroup !== group.id) {
      throw configurationError("Host protection status returned the wrong resource group.");
    }
    let open = await this.options.store.getOpenCase(group.id);
    if (status.state === "idle") return this.reconcileIdle(open, hostEpoch);
    if (!status.operationId)
      return { acknowledged: false, classification: "intervention", importedRecords: 0 };
    if (open && open.hostEpoch !== hostEpoch) {
      await this.options.store.markIntervention(open.id, "hostEpochChanged", this.now());
      return { acknowledged: false, classification: "intervention", importedRecords: 0 };
    }
    if (
      open &&
      open.operationId !== status.operationId &&
      this.options.supersededHostCasePolicy ===
        "acknowledgeAfterApplicationReconciliation"
    ) {
      await this.reconcileApplication(
        "intervention",
        open,
        await this.options.store.listImported(open.id),
      );
      await this.options.store.markAcknowledged(open.id, this.now());
      open = null;
    }
    if (
      open?.state === "ackPending" &&
      open.operationId !== status.operationId
    ) {
      await this.options.store.markAcknowledged(open.id, this.now());
      open = null;
    }
    if (open && open.operationId !== status.operationId) {
      await this.options.store.markIntervention(open.id, "hostOperationChanged", this.now());
      return { acknowledged: false, classification: "intervention", importedRecords: 0 };
    }

    const journal = await this.options.host.protectionJournal(status.operationId);
    const records = journal.filter(
      (record) => record.operationId === status.operationId && record.resourceGroup === group.id,
    );
    const journalScopeMismatch = records.length !== journal.length;
    const classification = journalScopeMismatch ? "intervention" : classify(status);
    const ingested = await this.options.store.ingest({
      classification,
      hostEpoch,
      importedAt: this.now(),
      records,
      status,
    });
    if (records.length === 0) {
      const recoveryCase = await this.options.store.markIntervention(
        ingested.recoveryCase.id,
        journalScopeMismatch ? "journalScopeMismatch" : "journalMissing",
        this.now(),
      );
      await this.reconcileApplication("intervention", recoveryCase, []);
      return { acknowledged: false, classification: "intervention", importedRecords: 0 };
    }

    await this.project(ingested.recoveryCase, ingested.records);
    await this.reconcileApplication(classification, ingested.recoveryCase, ingested.records);
    if (classification === "intervention") {
      await this.options.store.markIntervention(
        ingested.recoveryCase.id,
        journalScopeMismatch ? "journalScopeMismatch" : "hostProtectionIntervention",
        this.now(),
      );
      return { acknowledged: false, classification, importedRecords: ingested.records.length };
    }
    if (classification === "recovering") {
      return { acknowledged: false, classification, importedRecords: ingested.records.length };
    }

    await this.options.store.markAckPending(ingested.recoveryCase.id, this.now());
    await this.options.host.acknowledgeProtection({
      hostEpoch,
      operationId: status.operationId,
      resourceGroup: group.id,
    });
    await this.options.store.markAcknowledged(ingested.recoveryCase.id, this.now());
    return {
      acknowledged: true,
      classification: "ready",
      importedRecords: ingested.records.length,
    };
  }

  private async reconcileIdle(
    open: ProtectionRecoveryCase | null,
    hostEpoch: string,
  ): Promise<GroupResult> {
    if (!open) return { acknowledged: false, classification: "ready", importedRecords: 0 };
    if (open.hostEpoch === hostEpoch && open.state === "ackPending") {
      await this.options.store.markAcknowledged(open.id, this.now());
      return { acknowledged: true, classification: "ready", importedRecords: 0 };
    }
    if (
      this.options.idleHostCasePolicy ===
      "acknowledgeAfterApplicationReconciliation"
    ) {
      await this.reconcileApplication(
        "intervention",
        open,
        await this.options.store.listImported(open.id),
      );
      await this.options.store.markAcknowledged(open.id, this.now());
      return { acknowledged: true, classification: "ready", importedRecords: 0 };
    }
    const recoveryCase = await this.options.store.markIntervention(
      open.id,
      open.hostEpoch === hostEpoch ? "hostStateLost" : "hostEpochChanged",
      this.now(),
    );
    await this.reconcileApplication(
      "intervention",
      recoveryCase,
      await this.options.store.listImported(open.id),
    );
    return { acknowledged: false, classification: "intervention", importedRecords: 0 };
  }

  private async project(
    recoveryCase: ProtectionRecoveryCase,
    records: readonly ProtectionRecoveryImportedRecord[],
  ): Promise<void> {
    for (const record of records) {
      for (const projection of this.projections) {
        if (await this.options.store.isProjected(record.importId, projection.id)) continue;
        const idempotencyKey = `${record.importId}\u001f${projection.id}`;
        await projection.project({ idempotencyKey, record, recoveryCase });
        await this.options.store.markProjected(record.importId, projection.id, this.now());
      }
    }
  }

  private reconcileApplication(
    classification: ProtectionRecoveryClassification,
    recoveryCase: ProtectionRecoveryCase,
    records: readonly ProtectionRecoveryImportedRecord[],
  ): Promise<void> {
    return this.options.application.reconcile({
      classification,
      idempotencyKey: `${recoveryCase.id}\u001fapplication\u001f${classification}\u001f${recoveryCase.phase}`,
      records,
      recoveryCase,
    });
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

const classify = (status: HostProtectionStatus): ProtectionRecoveryClassification => {
  if (
    status.state === "intervention" ||
    status.phase === "custodyUnknown" ||
    status.custodyOutcome === "custodyUnknown"
  ) {
    return "intervention";
  }
  if (terminalOutcomes.has(status.custodyOutcome)) return "terminal";
  if (status.custodyOutcome && status.custodyOutcome !== "none") return "intervention";
  return "recovering";
};

const validateIdentities = <T extends { readonly id: string }>(
  values: readonly T[],
  kind: string,
): readonly T[] => {
  const identities = new Set<string>();
  for (const value of values) {
    if (!value.id.trim() || identities.has(value.id)) {
      throw configurationError(`Every ${kind} identity must be non-empty and unique.`);
    }
    identities.add(value.id);
  }
  return [...values];
};

const summary = (
  status: ProtectionRecoveryBarrierResult["status"],
  recoveringGroups: number,
  interventionGroups: number,
  failedGroups: number,
  importedRecords: number,
  acknowledgedGroups: number,
  hostAvailable: boolean,
): ProtectionRecoveryBarrierResult => ({
  safeSummary: {
    acknowledgedGroups,
    failedGroups,
    hostAvailable,
    importedRecords,
    interventionGroups,
    recoveringGroups,
  },
  status,
});

const configurationError = (message: string): FrameworkError =>
  new FrameworkError({
    category: "configuration",
    code: "xfs.protectionRecovery.configurationInvalid",
    message,
  });
