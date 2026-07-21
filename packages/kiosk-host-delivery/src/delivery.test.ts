import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostDeliveryRuntime } from "./runtime";
import { HostDeliveryPolicyRegistry } from "./policy";
import { createTestDatabase, MutableHostClock, testCipher } from "./test-fixture";

describe("durable host delivery", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => Promise.all(cleanup.splice(0).map((dispose) => dispose())));

  it("retries only a proven-not-sent request and reconciles one safe response", async () => {
    const fixture = await createTestDatabase();
    cleanup.push(fixture.dispose);
    const clock = new MutableHostClock();
    const send = vi.fn()
      .mockResolvedValueOnce({ errorCode: "network.not-connected", status: "notSent" })
      .mockResolvedValueOnce({
        payload: Uint8Array.from([0x30, 0x30]),
        responseId: "response-1",
        safeSummary: { responseCode: "00" },
        status: "response",
      });
    const runtime = createHostDeliveryRuntime({
      cipher: testCipher,
      clock,
      db: fixture.db,
      inquiry: { inquire: async () => ({ status: "notFound" }) },
      ownerId: "worker-1",
      policies: policies(),
      transport: { send },
    });
    await enqueue(runtime);

    await expect(runtime.worker.runOnce()).resolves.toMatchObject({ status: "retryScheduled" });
    clock.advance(1_000);
    await expect(runtime.worker.runOnce()).resolves.toMatchObject({ status: "reconciled" });
    await expect(runtime.deliveries.get("outbox-1")).resolves.toMatchObject({
      attemptCount: 2,
      responseId: "response-1",
      status: "reconciled",
    });
    const messages = await fixture.db.queryAll<{ payload_json: string }>(
      "SELECT payload_json FROM kiosk_transaction_message WHERE transaction_id = ? AND direction = 'inbound'",
      ["transaction-1"],
    );
    expect(messages).toEqual([{ payload_json: JSON.stringify({ responseCode: "00" }) }]);
    const payload = await fixture.db.queryOne<{ ciphertext: string }>(
      "SELECT ciphertext FROM kiosk_host_payload WHERE payload_ref = ?",
      ["host-request:outbox-1"],
    );
    expect(payload?.ciphertext).not.toContain("RAW-PIN-BLOCK");
  });

  it("moves unknown transport outcomes to inquiry without blind retry", async () => {
    const fixture = await createTestDatabase();
    cleanup.push(fixture.dispose);
    const send = vi.fn(async () => ({ errorCode: "network.disconnected", status: "unknown" as const }));
    const runtime = createHostDeliveryRuntime({
      cipher: testCipher,
      db: fixture.db,
      inquiry: {
        inquire: async () => ({
          payload: Uint8Array.from([0x30, 0x35]),
          responseId: "inquiry-response-1",
          safeSummary: { responseCode: "05" },
          status: "found",
        }),
      },
      ownerId: "worker-1",
      policies: policies(),
      transport: { send },
    });
    await enqueue(runtime);

    await expect(runtime.worker.runOnce()).resolves.toMatchObject({ status: "uncertain" });
    await expect(runtime.worker.runOnce()).resolves.toEqual({ status: "idle" });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(runtime.reconciliation.reconcile("outbox-1")).resolves.toBe("reconciled");
    await expect(runtime.deliveries.get("outbox-1")).resolves.toMatchObject({
      resolution: "inquiry",
      status: "reconciled",
    });
  });
});

const policies = () => new HostDeliveryPolicyRegistry().register({
  id: "authorization.standard",
  inquiryNotFound: "retry",
  leaseMs: 5_000,
  maxAttempts: 3,
  retryDelaysMs: [1_000, 5_000],
  uncertainStrategy: "inquiry",
  version: "1",
});

const enqueue = (runtime: ReturnType<typeof createHostDeliveryRuntime>) => runtime.queue.enqueue({
  channel: "iso8583",
  id: "outbox-1",
  idempotencyKey: "authorization:transaction-1",
  messageId: "authorization-request-1",
  messageType: "withdrawal.authorization",
  payload: new TextEncoder().encode("RAW-PIN-BLOCK"),
  policyId: "authorization.standard",
  safeSummary: { amountMinorUnits: 10_000, currency: "CNY" },
  transactionId: "transaction-1",
});
