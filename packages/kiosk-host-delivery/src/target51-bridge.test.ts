import { afterEach, describe, expect, it, vi } from "vitest";

import { HostDeliveryPolicyRegistry } from "./policy";
import { createHostDeliveryRuntime } from "./runtime";
import { createTestDatabase, testCipher } from "./test-fixture";

describe("Target 51 delivery bridge", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => Promise.all(cleanup.splice(0).map((dispose) => dispose())));

  it("dispatches one requested outbox and reads its durable response", async () => {
    const fixture = await createTestDatabase();
    cleanup.push(fixture.dispose);
    const send = vi.fn(async (input: { outboxId: string }) => ({
      payload: new TextEncoder().encode(`response:${input.outboxId}`),
      responseId: `response:${input.outboxId}`,
      safeSummary: { responseCode: "00" },
      status: "response" as const,
    }));
    const runtime = createHostDeliveryRuntime({
      cipher: testCipher,
      db: fixture.db,
      inquiry: { inquire: async () => ({ status: "notFound" }) },
      ownerId: "worker-1",
      policies: policies(),
      transport: { send },
    });
    await enqueue(runtime, "outbox-1");
    await enqueue(runtime, "outbox-2");

    await expect(runtime.worker.runOnce("outbox-2")).resolves.toMatchObject({
      outboxId: "outbox-2",
      status: "reconciled",
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ outboxId: "outbox-2" }));
    await expect(runtime.deliveries.get("outbox-1")).resolves.toMatchObject({ status: "pending" });
    const response = await runtime.responses.read("outbox-2");
    expect(new TextDecoder().decode(response?.payload)).toBe("response:outbox-2");
  });
});

const policies = () =>
  new HostDeliveryPolicyRegistry().register({
    id: "authorization.standard",
    inquiryNotFound: "retry",
    leaseMs: 5_000,
    maxAttempts: 2,
    retryDelaysMs: [1_000],
    uncertainStrategy: "inquiry",
    version: "1",
  });

const enqueue = (runtime: ReturnType<typeof createHostDeliveryRuntime>, id: string) =>
  runtime.queue.enqueue({
    channel: "test",
    id,
    idempotencyKey: id,
    messageId: `${id}:message`,
    messageType: "authorization",
    payload: new TextEncoder().encode(id),
    policyId: "authorization.standard",
    safeSummary: { operationType: "test" },
    transactionId: "transaction-1",
  });
