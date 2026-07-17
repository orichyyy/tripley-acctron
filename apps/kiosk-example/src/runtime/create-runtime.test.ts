import { describe, expect, it } from "vitest";

import { createExampleApplicationRuntime } from "./create-runtime";
import { createFakeNfcExtension } from "./fake-nfc-extension.fixture";

describe("kiosk example runtime", () => {
  it("fails closed for XFS entries without disabling an independent reservation entry", async () => {
    const application = await createExampleApplicationRuntime({
      connectHostd: async () => {
        throw new Error("hostd unavailable");
      },
      hostd: { idcLogicalName: "IDC", pinLogicalName: "PIN" },
      mode: "hostd",
    });

    expect(application.diagnostics.bootstrapError).toBe("hostd unavailable");
    expect(application.runtime.snapshot().readiness.entryMethods).toEqual([
      expect.objectContaining({ available: false, id: "card.contact" }),
      expect.objectContaining({ available: false, id: "qr" }),
      expect.objectContaining({ available: true, id: "reservation" }),
    ]);
  });

  it("removes the bank reservation contribution when its feature flag is disabled", async () => {
    const application = await createExampleApplicationRuntime({
      mode: "memory",
      reservationEnabled: false,
    });

    expect(application.runtime.snapshot().readiness.entryMethods.map((entry) => entry.id)).toEqual([
      "card.contact",
      "qr",
    ]);
  });

  it("fails runtime readiness when accessibility requires unavailable speech", async () => {
    const application = await createExampleApplicationRuntime({
      mode: "memory",
      speechRequired: true,
    });

    expect(application.runtime.snapshot().readiness.status).toBe("failed");
    await expect(
      application.runtime.start({ entryMethodId: "reservation", intentId: "speech-required" }),
    ).rejects.toMatchObject({ code: "command.blocked" });
  });

  it("runs the bank-specific reservation contribution through dynamic inputs", async () => {
    const application = await createExampleApplicationRuntime({ mode: "memory" });
    const result = application.runtime.start({
      entryMethodId: "reservation",
      intentId: "reservation-1",
    });

    await submitWhen(application, "reservation.number", "123456");
    await submitWhen(application, "reservation.secret", "secret1");
    await submitWhen(application, "withdrawal.amount", "100");

    await expect(result).resolves.toMatchObject({
      entryMethodId: "reservation",
      status: "completed",
    });
  });

  it("loads a custom NFC device, input adapter, and entry without modifying core", async () => {
    const application = await createExampleApplicationRuntime({
      extensions: [createFakeNfcExtension()],
      mode: "memory",
    });
    const result = application.runtime.start({ entryMethodId: "bank.nfc", intentId: "nfc-1" });

    await submitWhen(application, "withdrawal.amount", "400");

    await expect(result).resolves.toMatchObject({ entryMethodId: "bank.nfc", status: "completed" });
    expect(JSON.stringify(application.runtime.snapshot())).not.toContain("RAW-NFC-TOKEN");
  });

  it("keeps invalid amount input in place and completes card custody", async () => {
    const application = await createExampleApplicationRuntime({ mode: "memory" });
    const result = application.runtime.start({ entryMethodId: "card.contact", intentId: "card-1" });

    await submitWhen(application, "card.present", "presented");
    await submitWhen(application, "withdrawal.amount", "5");
    await waitUntil(
      () => application.runtime.snapshot().operation.feedback?.reasonCode === "INPUT.MIN_LENGTH",
    );
    await submitWhen(application, "withdrawal.amount", "100");
    await submitSecureWhen(application, "pin.enter");
    await submitWhen(application, "card.take", "taken");

    await expect(result).resolves.toMatchObject({ status: "completed" });
    expect(application.runtime.snapshot().operation.mediaCustody).toBe("returned");
  });

  it("runs QR through the registered adapter without changing runtime core", async () => {
    const application = await createExampleApplicationRuntime({ mode: "memory" });
    const result = application.runtime.start({ entryMethodId: "qr", intentId: "qr-1" });

    await submitWhen(application, "entry.qr.scan", "acctron://withdrawal/demo");
    await submitWhen(application, "withdrawal.amount", "200");
    await submitSecureWhen(application, "pin.enter");

    await expect(result).resolves.toMatchObject({ entryMethodId: "qr", status: "completed" });
  });

  it("cancels active input but keeps card compensation alive after interruption", async () => {
    const application = await createExampleApplicationRuntime({ mode: "memory" });
    const result = application.runtime.start({
      entryMethodId: "card.contact",
      intentId: "cancel-card",
    });

    await submitWhen(application, "card.present", "presented");
    await waitUntil(
      () => application.runtime.snapshot().operation.promptId === "withdrawal.amount",
    );
    const cancelling = application.commands.execute("kiosk.operation.cancel", {}, {});
    await submitWhen(application, "card.take", "taken");
    await cancelling;

    await expect(result).resolves.toMatchObject({
      reasonCode: "user.cancelled",
      status: "interrupted",
    });
    expect(application.runtime.snapshot().operation.mediaCustody).toBe("returned");
  });

  it("closes active work before requesting an explicit runtime mode reboot", async () => {
    const requestedModes: string[] = [];
    const application = await createExampleApplicationRuntime({
      mode: "memory",
      onReboot: (mode) => {
        requestedModes.push(mode);
      },
    });
    const result = application.runtime.start({
      entryMethodId: "reservation",
      intentId: "runtime-reboot",
    });
    await waitUntil(
      () => application.runtime.snapshot().operation.promptId === "reservation.number",
    );

    await application.commands.execute("kiosk.runtime.reboot", {}, { mode: "hostd" });

    await expect(result).resolves.toMatchObject({
      reasonCode: "runtime.dispose",
      status: "interrupted",
    });
    expect(requestedModes).toEqual(["hostd"]);
  });

  it("does not project raw reservation credentials into UI state", async () => {
    const application = await createExampleApplicationRuntime({ mode: "memory" });
    const reservationNumber = "987654";
    const reservationSecret = "s246810";
    const result = application.runtime.start({ entryMethodId: "reservation", intentId: "safe-ui" });

    await submitWhen(application, "reservation.number", reservationNumber);
    await submitWhen(application, "reservation.secret", reservationSecret);
    await submitWhen(application, "withdrawal.amount", "300");
    await expect(result).resolves.toMatchObject({ status: "completed" });

    const projection = JSON.stringify({
      runtime: application.runtime.snapshot(),
      ui: application.store.getState(),
    });
    expect(projection).not.toContain(reservationNumber);
    expect(projection).not.toContain(reservationSecret);
  });
});

const submitWhen = async (
  application: Awaited<ReturnType<typeof createExampleApplicationRuntime>>,
  promptId: string,
  value: string,
): Promise<void> => {
  await waitUntil(() => application.runtime.snapshot().operation.promptId === promptId);
  await application.commands.execute("kiosk.input.submit", {}, { value });
};

const submitSecureWhen = async (
  application: Awaited<ReturnType<typeof createExampleApplicationRuntime>>,
  promptId: string,
): Promise<void> => {
  await waitUntil(() => application.runtime.snapshot().operation.promptId === promptId);
  await application.commands.execute("kiosk.input.submit", {}, { secureConfirmation: true });
};

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for kiosk projection.");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
