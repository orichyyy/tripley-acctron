import type {
  HostDeliveryClock,
  HostPayloadVault,
  HostTransportPort,
} from "./contracts";
import { systemHostDeliveryClock } from "./contracts";
import { HostDeliveryPolicyRegistry } from "./policy";
import { HostResponseReconciliationService } from "./reconciliation";
import { SqliteHostDeliveryStore } from "./sqlite-store";

export interface HostDeliveryWorkResult {
  readonly status: "idle" | "reconciled" | "retryScheduled" | "uncertain" | "failed";
  readonly outboxId?: string | undefined;
}

export class HostDeliveryWorker {
  public constructor(
    private readonly ownerId: string,
    private readonly deliveries: SqliteHostDeliveryStore,
    private readonly vault: HostPayloadVault,
    private readonly policies: HostDeliveryPolicyRegistry,
    private readonly transport: HostTransportPort,
    private readonly responses: HostResponseReconciliationService,
    private readonly clock: HostDeliveryClock = systemHostDeliveryClock,
  ) {}

  public async runOnce(): Promise<HostDeliveryWorkResult> {
    const record = await this.deliveries.claimNext(this.ownerId, this.policies);
    if (!record) return { status: "idle" };
    const payload = await this.vault.get(record.payloadRef);
    if (!payload) {
      await this.deliveries.markFailed(record.id, "host.payload.unavailable");
      return { outboxId: record.id, status: "failed" };
    }
    let result;
    try {
      result = await this.transport.send({
        channel: record.channel,
        idempotencyKey: record.idempotencyKey,
        messageId: record.messageId,
        messageType: record.messageType,
        outboxId: record.id,
        payload,
        transactionId: record.transactionId,
      });
    } catch {
      await this.deliveries.markUncertain(record.id, "host.transport.exception");
      return { outboxId: record.id, status: "uncertain" };
    }
    if (result.status === "response") {
      const projected = await this.responses.apply({
        ...result,
        outboxId: record.id,
        source: "transport",
      });
      if (projected.status === "conflict") {
        await this.deliveries.markUncertain(record.id, "host.response.id-conflict");
        return { outboxId: record.id, status: "uncertain" };
      }
      return { outboxId: record.id, status: "reconciled" };
    }
    if (result.status === "unknown") {
      await this.deliveries.markUncertain(record.id, result.errorCode);
      return { outboxId: record.id, status: "uncertain" };
    }
    const policy = this.policies.require(record.policyId);
    if (record.attemptCount >= policy.maxAttempts) {
      await this.deliveries.markFailed(record.id, result.errorCode);
      return { outboxId: record.id, status: "failed" };
    }
    const delay = policy.retryDelaysMs[
      Math.min(record.attemptCount - 1, policy.retryDelaysMs.length - 1)
    ]!;
    const nextAttempt = new Date(this.clock.now().getTime() + delay).toISOString();
    await this.deliveries.scheduleRetry(record.id, nextAttempt, result.errorCode);
    return { outboxId: record.id, status: "retryScheduled" };
  }
}
