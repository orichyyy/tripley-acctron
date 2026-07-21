import type { EnqueueHostDeliveryInput, HostDeliveryRecord, HostPayloadVault } from "./contracts";
import { HostDeliveryPolicyRegistry } from "./policy";
import { SqliteHostDeliveryStore } from "./sqlite-store";

export class HostDeliveryQueue {
  public constructor(
    private readonly store: SqliteHostDeliveryStore,
    private readonly vault: HostPayloadVault,
    private readonly policies: HostDeliveryPolicyRegistry,
  ) {}

  public async enqueue(input: EnqueueHostDeliveryInput): Promise<HostDeliveryRecord> {
    const policy = this.policies.require(input.policyId);
    const payloadRef = `host-request:${input.id}`;
    await this.vault.put(payloadRef, input.payload);
    try {
      return await this.store.enqueue({
        ...input,
        payloadRef,
        policy,
      });
    } catch (error) {
      await this.vault.delete(payloadRef).catch(() => undefined);
      throw error;
    }
  }
}
