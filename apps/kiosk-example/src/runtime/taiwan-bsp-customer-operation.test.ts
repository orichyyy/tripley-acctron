import type { WithdrawalExecutionResult } from "@tripley-kit/web-container-withdrawal-orchestration";
import { describe, expect, it } from "vitest";

import type { BspV243IwdContext } from "../../script/bsp-v243/withdrawal-contracts";
import { createExampleApplicationRuntime } from "./create-runtime";
import { SensitiveOperationMaterialVault } from "./operation-material";
import {
  createTaiwanBspCustomerOperation,
  type TaiwanBspOperationContextAssembler,
} from "./taiwan-bsp-customer-operation";
import type { TaiwanBspWithdrawalInput } from "./taiwan-bsp-withdrawal";

describe("Taiwan BSP customer operation bridge", () => {
  it("runs command input through amount and secure PIN into Target 59 safely", async () => {
    const materials = new SensitiveOperationMaterialVault();
    const assemblies: Parameters<TaiwanBspOperationContextAssembler["assemble"]>[0][] = [];
    const executions: TaiwanBspWithdrawalInput[] = [];
    const business = createTaiwanBspCustomerOperation({
      application: {
        execute: async (input) => {
          executions.push(input);
          return completed(input);
        },
      },
      assembler: {
        assemble: async (input) => {
          assemblies.push(input);
          return {
            bspContext: context(),
            entryMode: "contact-card",
            safeMetadata: { entryMethodId: input.assessment.credential.entryMethodId },
          };
        },
      },
      currency: "TWD",
      materials,
      minorUnitFactor: 100,
    });
    const application = await createExampleApplicationRuntime({
      mode: "memory",
      withdrawalBusiness: business,
    });

    try {
      const running = application.runtime.start({
        entryMethodId: "card.contact",
        intentId: "target60-contact",
      });
      await submitWhen(application, "card.present", { value: "CARD-RAW-SECRET" });
      await submitWhen(application, "withdrawal.amount", { value: "100" });
      await submitWhen(application, "pin.enter", { secureConfirmation: true });
      const result = await running;

      expect(result).toMatchObject({
        safeOutput: {
          cardStatus: "returned",
          cashCustody: "taken",
          hostStatus: "approved",
          status: "completed",
        },
        status: "completed",
      });
      expect(executions).toHaveLength(1);
      expect(executions[0]).toMatchObject({
        amount: { currency: "TWD", minorUnits: 10_000 },
        entryMode: "contact-card",
      });
      expect(assemblies[0]?.material.credential.material).toBe("CARD-RAW-SECRET");
      expect(assemblies[0]?.material.authentication["pin.online"]).toMatchObject({
        encryptedPinBlock: "MEMORY-ADAPTER-PIN-BLOCK",
        kind: "securePin",
      });
      expect(materials.has(result.operationId)).toBe(false);
      expect(application.diagnostics.withdrawal.snapshot().latest).toMatchObject({
        card: { status: "returned" },
        cash: { custody: "taken", presented: true, taken: true },
        failureReason: "completed",
        host: { status: "approved" },
        operationId: result.operationId,
        status: "completed",
      });
      expect(application.runtime.snapshot().operation.promptId).not.toBe("card.take");
      const observable = JSON.stringify({
        operation: application.runtime.snapshot().operation,
        result,
      });
      expect(observable).not.toContain("CARD-RAW-SECRET");
      expect(observable).not.toContain("MEMORY-ADAPTER-PIN-BLOCK");
    } finally {
      await application.dispose();
    }
  });

  it("clears captured QR material when the operation exits before business execution", async () => {
    const materials = new SensitiveOperationMaterialVault();
    let executed = false;
    const business = createTaiwanBspCustomerOperation({
      application: {
        execute: async (input) => {
          executed = true;
          return completed(input);
        },
      },
      assembler: {
        assemble: async () => ({
          bspContext: context(),
          entryMode: "cardless-reservation",
        }),
      },
      currency: "TWD",
      materials,
      minorUnitFactor: 100,
    });
    const application = await createExampleApplicationRuntime({
      mode: "memory",
      withdrawalBusiness: business,
    });

    try {
      const running = application.runtime.start({
        entryMethodId: "qr",
        intentId: "target60-cancel",
      });
      await submitWhen(application, "entry.qr.scan", {
        value: "acctron://withdrawal/QR-RAW-SECRET",
      });
      await waitForPrompt(application, "withdrawal.amount");
      const operationId = application.runtime.snapshot().operation.operationId;
      expect(operationId).toBeDefined();
      expect(materials.has(operationId!)).toBe(true);

      await application.runtime.interrupt("user.cancelled");
      const result = await running;

      expect(result).toMatchObject({ reasonCode: "user.cancelled", status: "interrupted" });
      expect(executed).toBe(false);
      expect(materials.has(operationId!)).toBe(false);
      expect(JSON.stringify(application.runtime.snapshot().operation)).not.toContain(
        "QR-RAW-SECRET",
      );
    } finally {
      await application.dispose();
    }
  });
});

type Application = Awaited<ReturnType<typeof createExampleApplicationRuntime>>;

const submitWhen = async (
  application: Application,
  promptId: string,
  input: { readonly secureConfirmation?: boolean; readonly value?: string },
): Promise<void> => {
  await waitForPrompt(application, promptId);
  await application.commands.execute("kiosk.input.submit", {}, input);
};

const waitForPrompt = async (application: Application, promptId: string): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (application.runtime.snapshot().operation.promptId !== promptId) {
    if (Date.now() >= deadline) {
      throw new Error(`Prompt did not become active: ${promptId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const context = (): BspV243IwdContext => ({
  header: {
    atmId: "ATM00001",
    businessDate: "20260724",
    sequence: "001",
    systemDate: "20260724",
    versionDate: "20260317",
    versionMarker: "A",
  },
  ici: {},
});

const completed = (input: TaiwanBspWithdrawalInput): WithdrawalExecutionResult => ({
  outcome: {
    card:
      input.entryMode === "contact-card"
        ? { required: true, status: "returned" }
        : { required: false, status: "not-applicable" },
    cash: {
      custody: "taken",
      dispense: "completed",
      dispensed: true,
      present: "completed",
      presented: true,
      reconciliationRequired: false,
      retracted: false,
      taken: true,
    },
    entryMode: input.entryMode,
    host: {
      protocolId: "taiwan.bsp",
      protocolMode: "authorization-then-completion",
      protocolVersion: "2.43",
      status: "approved",
    },
    kind: "withdrawal.outcome",
    operationId: input.operationId,
    policyId: "taiwan.bsp.v243.withdrawal",
    policyVersion: "1.0.0",
    reason: "completed",
    safeSummary: { approved: true },
    status: "completed",
  },
});
