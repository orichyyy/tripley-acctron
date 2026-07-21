import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteAuditJournalRepository } from "@tripley-kit/web-container-kiosk-base";
import {
  type OperationFinalizationStore,
  OperationFinalizationRunner,
  OperationFinalizerRegistry,
} from "@tripley-kit/web-container-kiosk-runtime";
import { NodeSqliteConnection } from "@tripley-kit/web-container-storage-sqlite/node";
import { afterEach, describe, expect, it } from "vitest";

import { createExampleDurableTransactions } from "./durable-transactions";
import { createExampleDepositPolicy, createExampleWithdrawalPolicy } from "./transaction-policies";

describe("kiosk durable transaction integration", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, {
    force: true,
    recursive: true,
  }))));

  it("reopens transaction evidence and resumes an incomplete finalizer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tripley-kiosk-"));
    directories.push(directory);
    const path = join(directory, "transactions.db");
    const first = await createExampleDurableTransactions({
      db: new NodeSqliteConnection(path),
      protection: readyProtection,
    });
    await first.transactions.create({
      businessType: "withdrawal",
      id: "withdrawal-restart-1",
      traceId: "trace-restart-1",
    });
    await first.messages.append("withdrawal-restart-1", {
      direction: "outbound",
      id: "message-restart-1",
      messageType: "host.withdrawal.authorization",
      payload: { amountMinorUnits: 10_000, currency: "CNY" },
    });
    await first.audit.append({
      eventId: "withdrawal.dispensed",
      message: "Cash dispense completed",
      transactionId: "withdrawal-restart-1",
    });
    const failedRunner = finalizationRunner(first.finalizationStore, true);
    await expect(failedRunner.run(finalizationContext)).rejects.toThrow("restart-required");
    await first.dispose();

    const second = await createExampleDurableTransactions({
      configureFinalizationRecovery: ({ registry, store }) => {
        registry.register(finalizationRunner(store, false));
      },
      db: new NodeSqliteConnection(path),
      protection: readyProtection,
    });

    expect(second.readiness).toMatchObject({
      incompleteFinalizationCount: 1,
      status: "ready",
    });
    await expect(second.transactions.get("withdrawal-restart-1")).resolves.toMatchObject({
      businessType: "withdrawal",
    });
    await expect(second.messages.list("withdrawal-restart-1")).resolves.toHaveLength(1);
    await expect(
      new SqliteAuditJournalRepository(second.connection)
        .listByTransaction("withdrawal-restart-1"),
    ).resolves.toHaveLength(1);
    await expect(second.finalizationStore.load("withdrawal-restart-1")).resolves.toMatchObject({
      status: "completed",
    });
    await second.dispose();
  });

  it("keeps host completion and cash-order choices in project-owned policy", () => {
    const withdrawal = createExampleWithdrawalPolicy({
      cardOrder: "return-after-cash-terminal",
      hostFinancialCompletion: true,
    });
    const deposit = createExampleDepositPolicy({
      hostFinancialCompletion: false,
      logicalService: "CashAcceptor1",
      resourceGroup: "cash-transport-1",
      reviewGate: { evaluate: async () => ({ decision: "confirm" }), id: "deposit.review" },
    });

    expect(withdrawal.policies.require("acctron.withdrawal.standard")).toMatchObject({
      cardOrder: "return-after-cash-terminal",
      hostProtocol: { mode: "authorization-then-completion" },
    });
    expect(deposit.policies.require("acctron.deposit.standard")).toMatchObject({
      hostProtocol: { mode: "authorization-only" },
      logicalService: "CashAcceptor1",
    });
  });
});

const readyProtection = {
  recover: async () => ({ safeSummary: {}, status: "ready" as const }),
};

const finalizationContext = {
  metadata: { policyId: "acctron.withdrawal.standard" },
  operationId: "withdrawal-restart-1",
  result: { kind: "withdrawal.outcome", safeSummary: { status: "completed" } },
};

const finalizationRunner = (
  store: OperationFinalizationStore,
  fail: boolean,
) => new OperationFinalizationRunner(
  new OperationFinalizerRegistry().register({
    execute: async () => {
      if (fail) throw new Error("restart-required");
    },
    id: "project.receipt.finalize",
    version: "1",
  }),
  store,
  () => new Date(),
  { project: (context) => ({ ...context, error: undefined }) },
);
