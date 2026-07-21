import type {
  HostDeliveryClock,
  HostInquiryPort,
  HostPayloadVault,
  HostResponseInput,
  ManualHostResolution,
} from "./contracts";
import { systemHostDeliveryClock } from "./contracts";
import { HostDeliveryPolicyRegistry } from "./policy";
import { SqliteHostReconciliationStore } from "./sqlite-reconciliation";
import { SqliteHostDeliveryStore } from "./sqlite-store";

export class HostResponseReconciliationService {
  public constructor(
    private readonly store: SqliteHostReconciliationStore,
    private readonly vault: HostPayloadVault,
  ) {}

  public async apply(input: HostResponseInput) {
    const payloadRef = `host-response:${input.responseId}`;
    await this.vault.put(payloadRef, input.payload);
    return this.store.applyResponse({
      outboxId: input.outboxId,
      payloadRef,
      responseId: input.responseId,
      safeSummary: input.safeSummary,
      source: input.source,
    });
  }
}

export class HostUncertainReconciliationService {
  public constructor(
    private readonly deliveries: SqliteHostDeliveryStore,
    private readonly responses: HostResponseReconciliationService,
    private readonly policies: HostDeliveryPolicyRegistry,
    private readonly inquiry: HostInquiryPort,
    private readonly clock: HostDeliveryClock = systemHostDeliveryClock,
  ) {}

  public async reconcile(outboxId: string): Promise<"reconciled" | "retryScheduled" | "manualRequired" | "unavailable"> {
    const record = await this.deliveries.get(outboxId);
    if (!record) throw new Error(`Host delivery record not found: ${outboxId}`);
    if (record.status !== "uncertain") throw new Error(`Host delivery is not uncertain: ${outboxId}`);
    const policy = this.policies.require(record.policyId);
    if (policy.version !== record.policyVersion || policy.uncertainStrategy === "manual") {
      return "manualRequired";
    }
    let result;
    try {
      result = await this.inquiry.inquire({
        idempotencyKey: record.idempotencyKey,
        messageId: record.messageId,
        messageType: record.messageType,
        outboxId: record.id,
        safeSummary: record.safeSummary,
        transactionId: record.transactionId,
      });
    } catch {
      return "unavailable";
    }
    if (result.status === "found") {
      await this.responses.apply({ ...result, outboxId, source: "inquiry" });
      return "reconciled";
    }
    if (result.status === "unavailable") return "unavailable";
    if (policy.inquiryNotFound === "manual") return "manualRequired";
    await this.deliveries.scheduleRetry(
      outboxId,
      this.clock.now().toISOString(),
      "host.inquiry.not-found",
    );
    return "retryScheduled";
  }
}

export class ManualHostReconciliationService {
  public constructor(
    private readonly store: SqliteHostReconciliationStore,
    private readonly clock: HostDeliveryClock = systemHostDeliveryClock,
  ) {}

  public resolve(input: {
    readonly outboxId: string;
    readonly resolution: ManualHostResolution;
    readonly operatorId: string;
    readonly reasonCode: string;
  }): Promise<void> {
    return this.store.applyManualResolution({
      ...input,
      ...(input.resolution === "confirmedNotSent"
        ? { retryAt: this.clock.now().toISOString() }
        : {}),
    });
  }
}
