import { describe, expect, it } from "vitest";

import {
  InMemoryAuditJournalRepository,
  InMemoryTransactionRepository,
  addProjectExtension,
  createKioskProjectBlueprint,
  createProjectSpecificInputExtension,
  createWithdrawalExampleProject,
  kioskStandardMigrations,
} from "./index";
import { AuditJournalService, FeatureFlagService, InMemoryOperationLedger } from "./services";

describe("kiosk base", () => {
  it("exposes standard migrations and repositories", async () => {
    const transactionRepository = new InMemoryTransactionRepository();
    const transaction = await transactionRepository.create({
      businessType: "withdrawal",
      id: "txn-1",
      traceId: "trace-1",
    });
    await transactionRepository.appendMessage(transaction.id, {
      direction: "outbound",
      id: "msg-1",
      messageType: "host.withdrawal.request",
      payload: { amount: 100 },
    });

    expect(kioskStandardMigrations.map((migration) => migration.id)).toEqual([
      "kiosk-base.001.transaction",
      "kiosk-base.002.audit-journal",
      "kiosk-base.003.operation-ledger-outbox",
    ]);
    await expect(transactionRepository.listMessages(transaction.id)).resolves.toHaveLength(1);
  });

  it("records audit/EJ, feature flags, and operation ledger state", async () => {
    const auditRepository = new InMemoryAuditJournalRepository();
    const audit = new AuditJournalService(auditRepository);
    const flags = new FeatureFlagService([{ enabled: true, id: "features.withdrawal.enabled" }]);
    const ledger = new InMemoryOperationLedger();

    await audit.append({
      eventId: "customer.selected.withdrawal",
      message: "Customer selected withdrawal",
      transactionId: "txn-1",
    });
    await ledger.start("host.withdrawal", "withdrawal:txn-1");
    await ledger.complete("withdrawal:txn-1", { result: "approved" });

    expect(flags.isEnabled("features.withdrawal.enabled")).toBe(true);
    await expect(auditRepository.listByTransaction("txn-1")).resolves.toHaveLength(1);
    await expect(ledger.get("withdrawal:txn-1")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("demonstrates withdrawal command, validation feedback, secure pin, and extension seam", async () => {
    const extension = createProjectSpecificInputExtension();
    const project = createWithdrawalExampleProject([extension]);
    const extendedBlueprint = addProjectExtension(createKioskProjectBlueprint(), {
      id: "bank-demo",
      inputSources: [extension.kind],
    });

    await expect(project.runCommand()).resolves.toMatchObject({
      businessType: "withdrawal",
      id: "txn-withdrawal-demo",
    });

    const validationFailure = await project.runValidationFailure();
    expect(validationFailure.result).toMatchObject({
      nodeId: "enterAmount",
      type: "stay",
    });
    expect(validationFailure.uiFeedback.at(-1)).toMatchObject({
      messageKey: "withdrawal.amount.invalid",
      status: "invalid",
    });

    await expect(project.runSecurePin()).resolves.toMatchObject({
      status: "completed",
    });
    expect(project.inputSources.has("bank.demoPalmScanner.identity")).toBe(true);
    expect(extendedBlueprint.extensionPoints).toContain("project:bank-demo");
  });
});
