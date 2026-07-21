import { afterEach, describe, expect, it } from "vitest";

import { NodeSqliteConnection } from "@tripley-kit/web-container-storage-sqlite/node";

import { createHostDeliveryRuntime } from "./runtime";
import { HostDeliveryPolicyRegistry } from "./policy";
import { createTestDatabase, MutableHostClock, testCipher } from "./test-fixture";

describe("host delivery restart and manual reconciliation", () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => Promise.all(cleanup.splice(0).map((dispose) => dispose())));

  it("turns an expired process lease into uncertain after reopening the SQLite file", async () => {
    const fixture = await createTestDatabase();
    const clock = new MutableHostClock();
    const first = runtime(fixture.db, clock);
    await enqueue(first);
    await first.deliveries.claimNext("crashed-worker", policySet());
    await fixture.close();

    clock.advance(5_001);
    const reopenedDb = new NodeSqliteConnection(fixture.path);
    const reopened = runtime(reopenedDb, clock);
    await expect(reopened.worker.runOnce()).resolves.toEqual({ status: "idle" });
    await expect(reopened.deliveries.get("outbox-restart")).resolves.toMatchObject({
      lastErrorCode: "host.delivery.lease-expired",
      status: "uncertain",
    });
    cleanup.push(async () => {
      await reopenedDb.close();
      await fixture.dispose().catch(() => undefined);
    });
  });

  it("deduplicates responses and records authorized manual resolution", async () => {
    const fixture = await createTestDatabase();
    cleanup.push(fixture.dispose);
    const clock = new MutableHostClock();
    const host = runtime(fixture.db, clock);
    await enqueue(host);
    await host.deliveries.markUncertain("outbox-restart", "host.transport.unknown");
    const response = {
      outboxId: "outbox-restart",
      payload: Uint8Array.from([1, 2]),
      responseId: "response-deduplicated",
      safeSummary: { responseCode: "00" },
      source: "inquiry" as const,
    };
    await expect(host.responses.apply(response)).resolves.toMatchObject({ status: "reconciled" });
    await expect(host.responses.apply(response)).resolves.toMatchObject({ status: "duplicate" });
    const count = await fixture.db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM kiosk_transaction_message WHERE transaction_id = ? AND direction = 'inbound'",
      ["transaction-1"],
    );
    expect(count?.count).toBe(1);
    await expect(host.manual.resolve({
      operatorId: "operator-7",
      outboxId: "outbox-restart",
      reasonCode: "invalid-override",
      resolution: "confirmedNotSent",
    })).rejects.toThrow("cannot be manually resolved from reconciled");

    await enqueue(host, "outbox-manual");
    await host.deliveries.markUncertain("outbox-manual", "host.transport.unknown");
    await host.manual.resolve({
      operatorId: "operator-7",
      outboxId: "outbox-manual",
      reasonCode: "host-portal-confirmed-not-found",
      resolution: "confirmedNotSent",
    });
    await expect(host.deliveries.get("outbox-manual")).resolves.toMatchObject({
      resolution: "manual:confirmedNotSent",
      status: "retryScheduled",
    });
    const audits = await fixture.db.queryAll<{ data_json: string }>(
      "SELECT data_json FROM kiosk_audit_journal WHERE event_id = 'host.delivery.manual-resolution'",
    );
    expect(audits[0]?.data_json).toContain("operator-7");
  });
});

const policySet = () => new HostDeliveryPolicyRegistry().register({
  id: "authorization.standard",
  inquiryNotFound: "manual",
  leaseMs: 5_000,
  maxAttempts: 2,
  retryDelaysMs: [1_000],
  uncertainStrategy: "inquiry",
  version: "1",
});

const runtime = (
  db: NodeSqliteConnection,
  clock: MutableHostClock,
) => createHostDeliveryRuntime({
  cipher: testCipher,
  clock,
  db,
  inquiry: { inquire: async () => ({ status: "notFound" }) },
  ownerId: "worker-restart",
  policies: policySet(),
  transport: { send: async () => ({ errorCode: "unused", status: "unknown" }) },
});

const enqueue = (
  host: ReturnType<typeof runtime>,
  id = "outbox-restart",
) => host.queue.enqueue({
  channel: "iso8583",
  id,
  idempotencyKey: `authorization:${id}`,
  messageId: `message:${id}`,
  messageType: "withdrawal.authorization",
  payload: Uint8Array.from([1, 2, 3]),
  policyId: "authorization.standard",
  safeSummary: { amountMinorUnits: 10_000 },
  transactionId: "transaction-1",
});
