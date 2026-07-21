import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDurableKioskTransactionRuntime } from "@tripley-kit/web-container-kiosk-transaction-runtime";
import { NodeSqliteConnection } from "@tripley-kit/web-container-storage-sqlite/node";
import { describe, expect, it } from "vitest";

import { prepareHostdCdmSimulator } from "./cdm-smoke";
import { runHostdCimTransaction } from "./cim-smoke";
import { xfsHostdTestConfigFromEnv } from "./config";

const confirmation = "I_UNDERSTAND_SIMULATOR_ONLY";
const describeReal = process.env.XFS_REAL_DURABLE_KIOSK_SMOKE === confirmation
  ? describe
  : describe.skip;

describeReal("hostd-backed durable kiosk evidence", () => {
  it("reopens safe CDM and CIM evidence after hostd simulator automation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tripley-hostd-durable-"));
    const path = join(directory, "hostd-evidence.db");
    try {
      const config = xfsHostdTestConfigFromEnv();
      const cdm = await prepareHostdCdmSimulator({
        ...(process.env.TRIPLEY_XFS_CDM_LOGICAL_NAME
          ? { logicalName: process.env.TRIPLEY_XFS_CDM_LOGICAL_NAME }
          : {}),
        resourceGroup: config.cimResourceGroup,
        protectionPolicyProfileId: config.protectionProfileId,
      });
      const cim = await runHostdCimTransaction(config);
      const first = createRuntime(path);
      await expect(first.startup.initialize()).resolves.toMatchObject({ status: "ready" });
      await persistDeviceEvidence(first, "withdrawal-hostd-smoke", "cdm", {
        cashUnitCount: cdm.cashUnitCount,
        hostEpoch: cdm.hostEpoch,
        logicalName: cdm.logicalName,
      });
      await persistDeviceEvidence(first, "deposit-hostd-smoke", "cim", {
        afterRevision: cim.afterRevision,
        beforeRevision: cim.beforeRevision,
        logicalName: cim.logicalName,
        noteCount: cim.noteCount,
      });
      await first.close();

      const reopened = createRuntime(path);
      await reopened.startup.initialize();
      await expect(reopened.messages.list("withdrawal-hostd-smoke")).resolves.toHaveLength(1);
      await expect(reopened.messages.list("deposit-hostd-smoke")).resolves.toHaveLength(1);
      expect(JSON.stringify(await reopened.messages.list("deposit-hostd-smoke"))).not.toContain("raw");
      await reopened.close();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

const createRuntime = (path: string) => {
  const db = new NodeSqliteConnection(path);
  return {
    ...createDurableKioskTransactionRuntime({
      db,
      protection: { recover: async () => ({ safeSummary: {}, status: "ready" }) },
    }),
    close: () => db.close(),
  };
};

const persistDeviceEvidence = async (
  runtime: ReturnType<typeof createRuntime>,
  operationId: string,
  module: "cdm" | "cim",
  payload: Readonly<Record<string, string | number>>,
): Promise<void> => {
  await runtime.transactions.create({ businessType: module, id: operationId });
  await runtime.messages.append(operationId, {
    direction: "inbound",
    id: `${operationId}-message`,
    messageType: `xfs.${module}.safe-summary`,
    payload,
  });
  await runtime.audit.append({
    data: payload,
    eventId: `xfs.${module}.hostd-smoke`,
    message: `Hostd ${module.toUpperCase()} smoke completed`,
    transactionId: operationId,
  });
};
