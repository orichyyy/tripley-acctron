import type {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import type {
  AuthenticationChallengeContribution,
  EntryMethodContribution,
  OperationExecutionContext,
} from "@tripley-kit/web-container-kiosk-runtime";
import type { XfsCardReaderPort } from "@tripley-kit/web-container-xfs-device-service";

import { type InputRunnerDependencies, runUserInput } from "./input-runner";
import type { OperationMaterialCapturePort } from "./operation-material";

export interface ContributionDependencies extends InputRunnerDependencies {
  readonly mode: "memory" | "hostd";
  readonly cardDeviceId: string;
  readonly pinDeviceId: string;
  readonly pinOptions: Readonly<Record<string, unknown>>;
  readonly barcodeDeviceId: string;
  readonly reservationVerification: ReservationVerificationPort;
  readonly operationMaterial?: OperationMaterialCapturePort | undefined;
}

export interface ReservationVerificationPort {
  verify(
    input: { readonly reservationNumber: string; readonly secret: string },
    signal: AbortSignal,
  ): Promise<void>;
}

export const createContactCardEntry = (
  dependencies: ContributionDependencies,
): EntryMethodContribution => ({
  acquisition: {
    flow: { flowId: "bank.withdrawal.card.acquire", version: "1.0.0" },
    acquire: async (ctx) => {
      const material = await runUserInput(ctx, dependencies, {
        id: "card-present",
        profile: { id: "card.present", promptKey: "card.present" },
        promptId: "card.present",
        sources: dependencies.mode === "hostd"
          ? [{
              deviceId: dependencies.cardDeviceId,
              id: "card",
              kind: "cardReader.card",
              options: { dataSources: 2 },
              required: true,
            }]
          : [{ id: "card.present", kind: "ui.command" }],
      });
      await dependencies.operationMaterial?.captureCredential({
        entryMethodId: "card.contact",
        material,
        operationId: ctx.operationId,
      });
      await ctx.setMediaCustody("acquired");
      return safeAssessment(ctx, "card.contact", ["pin.online"]);
    },
  },
  availability: () => ({ available: true }),
  id: "card.contact",
  labelKey: "entry.card.contact",
  mediaCustody: createCardCustodyPolicy(dependencies),
  order: 10,
  requiredCapabilities: dependencies.mode === "hostd" ? ["device.idc", "device.pin"] : [],
  version: "1.0.0",
});

export const createQrEntry = (dependencies: ContributionDependencies): EntryMethodContribution => ({
  acquisition: {
    flow: { flowId: "bank.withdrawal.qr.acquire", version: "1.0.0" },
    acquire: async (ctx) => {
      const material = await runUserInput(ctx, dependencies, {
        id: "acquireQr",
        profile: { id: "qr", promptKey: "entry.qr.scan" },
        promptId: "entry.qr.scan",
        sources: [
          {
            deviceId: dependencies.barcodeDeviceId,
            id: "qr",
            kind: "barcodeReader.qr",
            required: true,
          },
        ],
      });
      await dependencies.operationMaterial?.captureCredential({
        entryMethodId: "qr",
        material,
        operationId: ctx.operationId,
      });
      return safeAssessment(ctx, "qr", ["pin.online"]);
    },
  },
  availability: () => ({ available: true }),
  id: "qr",
  labelKey: "entry.qr",
  mediaCustody: noCustody,
  order: 20,
  requiredCapabilities: dependencies.mode === "hostd" ? ["device.bcr", "device.pin"] : [],
  version: "1.0.0",
});

export const createReservationEntry = (
  dependencies: ContributionDependencies,
): EntryMethodContribution => ({
  acquisition: {
    flow: { flowId: "bank.withdrawal.reservation.acquire", version: "1.0.0" },
    acquire: async (ctx) => {
      const reservationNumber = String(
        await runUserInput(ctx, dependencies, {
          attemptPolicyId: "reservation.number",
          id: "reservationNumber",
          profile: {
            constraints: { inputMode: "numeric", maxLength: 12, minLength: 6 },
            id: "reservation.number",
            promptKey: "reservation.number",
          },
          promptId: "reservation.number",
          sources: [{ id: "reservationNumber", kind: "ui.command" }],
        }),
      );
      const secret = String(
        await runUserInput(ctx, dependencies, {
          attemptPolicyId: "reservation.secret",
          id: "reservationSecret",
          profile: {
            constraints: { inputMode: "text", maxLength: 16, minLength: 6 },
            id: "reservation.secret",
            promptKey: "reservation.secret",
          },
          promptId: "reservation.secret",
          security: "secure",
          sources: [{ id: "reservationSecret", kind: "ui.command", secure: true }],
        }),
      );
      await dependencies.reservationVerification.verify({ reservationNumber, secret }, ctx.signal);
      await dependencies.operationMaterial?.captureCredential({
        entryMethodId: "reservation",
        material: { reservationNumber, secret },
        operationId: ctx.operationId,
      });
      return safeAssessment(ctx, "reservation", []);
    },
  },
  availability: () => ({ available: true }),
  id: "reservation",
  labelKey: "entry.reservation",
  mediaCustody: noCustody,
  order: 30,
  version: "1.0.0",
});

export const createOnlinePinChallenge = (
  dependencies: ContributionDependencies,
): AuthenticationChallengeContribution => ({
  execute: async (ctx) => {
    const result = await runUserInput(ctx, dependencies, {
      attemptPolicyId: "pin.online",
      id: "onlinePin",
      profile: {
        constraints: { maxLength: 12, minLength: 4 },
        id: "pin.online",
        promptKey: "pin.enter",
        sourceOptions: {
          "pinpad.pin": dependencies.pinOptions,
        },
      },
      promptId: "pin.enter",
      security: "secure",
      sources: [
        {
          deviceId: dependencies.pinDeviceId,
          id: "pin",
          kind: "pinpad.pin",
          secure: true,
        },
      ],
    });
    await dependencies.operationMaterial?.captureAuthentication({
      challengeId: "pin.online",
      material: result,
      operationId: ctx.operationId,
    });
    return {
      authenticated: Boolean(result),
      safeSummary: { hasEncryptedPinBlock: Boolean(result) },
    };
  },
  id: "pin.online",
  requiredCapabilities: dependencies.mode === "hostd" ? ["device.pin"] : [],
  version: "1.0.0",
});

export const collectWithdrawalAmount = async (
  ctx: OperationExecutionContext,
  dependencies: InputRunnerDependencies,
): Promise<number> => {
  const result = await runUserInput(ctx, dependencies, {
    attemptPolicyId: "withdrawal.amount",
    id: "withdrawalAmount",
    profile: {
      constraints: { inputMode: "numeric", maxLength: 4, minLength: 2 },
      errorMessageKeys: { minLength: "withdrawal.amount.tooShort" },
      id: "withdrawal.amount.dynamic",
      promptKey: "withdrawal.amount",
    },
    promptId: "withdrawal.amount",
    sources: [{ id: "amount", kind: "ui.command" }],
    validation: {
      local: (input) => {
        const amount = Number(input.value);
        return amount > 0 && amount % 10 === 0
          ? { valid: true, value: amount }
          : {
              messageKey: "withdrawal.amount.invalid",
              reasonCode: "AMOUNT.INVALID",
              valid: false,
            };
      },
    },
  });
  return Number(result);
};

const createCardCustodyPolicy = (
  dependencies: ContributionDependencies,
): EntryMethodContribution["mediaCustody"] => ({
  kind: "physical",
  reconcile: async ({ operationId, signal }) => {
    if (dependencies.mode !== "hostd") {
      return { status: "returned" };
    }
    return returnHostdCard(dependencies, operationId, signal);
  },
  resolve: async (ctx) => {
    if (dependencies.mode === "memory") {
      ctx.updateView({ phase: "takeMedia", promptId: "card.take" });
      try {
        await acquireUiValue(
          {
            ...ctx,
            interactionTimeout: () => 15_000,
            signal: ctx.compensationSignal,
          },
          dependencies,
          "card.take",
          "action",
        );
        return { status: "returned" };
      } catch {
        return { reasonCode: "card.custodyUnknown", status: "unknown" };
      }
    }
    return returnHostdCard(dependencies, ctx.operationId, ctx.compensationSignal, () =>
      ctx.updateView({ phase: "takeMedia", promptId: "card.take" }),
    );
  },
});

const returnHostdCard = async (
  dependencies: ContributionDependencies,
  operationId: string,
  signal: AbortSignal,
  onCardPresent?: () => void,
): Promise<{ status: "returned" | "retained" | "unknown"; reasonCode?: string }> => {
  const port = dependencies.devices.require<XfsCardReaderPort>(dependencies.cardDeviceId);
  try {
    const status = await port.getMediaStatus();
    if (status.state === "notPresent") {
      return { status: "returned" };
    }
    onCardPresent?.();
    await port.ejectCard({ position: "exit" }, { operationId, signal });
    const taken = await port.waitForTaken({ timeoutMs: 15_000 }, { operationId, signal });
    if (taken.taken) {
      return { status: "returned" };
    }
    await port.retainCard({}, { operationId, signal });
    return { status: "retained" };
  } catch {
    return { reasonCode: "card.custodyUnknown", status: "unknown" };
  }
};

const acquireUiValue = async (
  ctx: OperationExecutionContext,
  dependencies: InputRunnerDependencies,
  promptId: string,
  inputMode: "action" | "text",
): Promise<unknown> =>
  runUserInput(ctx, dependencies, {
    id: promptId.replace(/\./g, "-"),
    profile: {
      constraints: { inputMode: inputMode === "action" ? "text" : inputMode },
      id: promptId,
      promptKey: promptId,
    },
    promptId,
    sources: [{ id: promptId, kind: "ui.command" }],
  });

const safeAssessment = (
  ctx: OperationExecutionContext,
  entryMethodId: string,
  requirements: readonly string[],
) => ({
  credential: {
    entryMethodId,
    id: `credential-${ctx.operationId}`,
    safeSummary: { acquired: true, entryMethodId },
  },
  requirements: requirements.map((kind) => ({ kind })),
  riskBand: "standard" as const,
});

const noCustody: EntryMethodContribution["mediaCustody"] = {
  kind: "none",
  resolve: async () => ({ status: "none" }),
};

export const createContributionDependencies = (input: {
  mode: "memory" | "hostd";
  devices: DeviceRegistry;
  flowEngine: InputRunnerDependencies["flowEngine"];
  locks: DeviceLockManager;
  inputSources: InputSourceRegistry;
  operationMaterial?: OperationMaterialCapturePort | undefined;
  reservationVerification?: ReservationVerificationPort | undefined;
  pinOptions?: Readonly<Record<string, unknown>> | undefined;
  programmaticInputKinds?: readonly string[] | undefined;
}): ContributionDependencies => ({
  ...input,
  barcodeDeviceId: "barcodeReader",
  cardDeviceId: "cardReader",
  pinDeviceId: "pinpad",
  pinOptions: input.pinOptions ?? { format: 2, keyName: "TripleyConformanceCrypt" },
  reservationVerification: input.reservationVerification ?? defaultReservationVerification,
});

const defaultReservationVerification: ReservationVerificationPort = {
  verify: async ({ reservationNumber, secret }, signal) => {
    if (signal.aborted) {
      throw new Error("Reservation verification was cancelled.");
    }
    if (reservationNumber.length < 6 || secret.length < 6) {
      throw new Error("Reservation verification rejected.");
    }
  },
};
