import { describe, expect, it } from "vitest";
import { BspCredentialMapperRegistry } from "./credential-mapper-registry";
import {
  BspOperationContextError,
  type BspCredentialMapper,
} from "./operation-context-contracts";
import { BspV243OperationContextAssembler } from "./operation-context-assembler";
import { bspWithdrawalIciLayout } from "./withdrawal-profile";
import { createBspXfsIdcCredentialMapper } from "./xfs-idc-credential-mapper";

const TRACK3_SOURCE = 4;
const TRACK3 = "TRACK3-PRODUCTION-FIXTURE";
const PIN_BLOCK = "0123456789ABCDEF";
const CARD_ACCOUNT = "6222021234567890";
const TRANSACTION_ACCOUNT = "1234567890123456";

describe("BspV243OperationContextAssembler", () => {
  it("assembles the legacy shared-header and ICI golden vector", async () => {
    const assembler = createAssembler(createContactRegistry());

    const result = await assembler.assemble(contactInput());

    expect(result.bspContext.header).toEqual({
      atmId: "00001",
      businessDate: "20260724",
      depositMode: undefined,
      deviceStatus: "000000000000",
      mode: "1",
      notesFiveToEight: undefined,
      sequence: "00000175",
      serviceStatus: "0",
      systemDate: "20260724",
      transmissionArea: "  ",
      versionDate: "20260206",
      versionMarker: "V",
    });
    expect(iciWirePrefix(result.bspContext.ici)).toBe(
      [
        "807",
        CARD_ACCOUNT,
        TRANSACTION_ACCOUNT,
        "000",
        "0000000000000000",
        PIN_BLOCK,
        TRACK3.padEnd(104, " "),
        "00001000",
      ].join(""),
    );
    expect(result.bspContext.ici).toMatchObject({
      inAtmBusinessDay: "24",
      inCurrencyCode: "00",
      inMac: "A1B2C3D4",
      inMacDate: "260724",
      inTerminalCheck: "87654321",
    });
    expect(result.entryMode).toBe("contact-card");

    const safeJson = JSON.stringify(result.safeMetadata);
    expect(safeJson).toContain("taiwan-bsp.xfs-idc");
    expect(safeJson).not.toContain(CARD_ACCOUNT);
    expect(safeJson).not.toContain(PIN_BLOCK);
    expect(safeJson).not.toContain(TRACK3);
    expect(safeJson).not.toContain("A1B2C3D4");
  });

  it("fails before security processing when secure PIN input is missing", async () => {
    let securityCalls = 0;
    const assembler = createAssembler(createContactRegistry(), () => {
      securityCalls += 1;
      return { mac: "A1B2C3D4", terminalCheck: "87654321" };
    });
    const input = contactInput();

    const failure = await assembler
      .assemble({
        ...input,
        materials: { ...input.materials, authentication: {} },
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BspOperationContextError);
    expect(failure).toMatchObject({
      code: "BSP_PIN_REQUIRED",
      fieldId: "inPinBlock",
    });
    expect(JSON.stringify(failure)).not.toContain(CARD_ACCOUNT);
    expect(JSON.stringify(failure)).not.toContain(TRACK3);
    expect(securityCalls).toBe(0);
  });

  it("supports a project-owned cardless mapper without changing core", async () => {
    const registry = new BspCredentialMapperRegistry();
    const mapper: BspCredentialMapper = {
      entryMethodIds: ["reservation.code"],
      entryMode: "cardless-reservation",
      id: "bank.reservation-v1",
      map: ({ material }) => {
        const reservation = material as {
          readonly bankNumber: string;
          readonly hostAccount: string;
        };
        return {
          ici: {
            inBankNumber: reservation.bankNumber,
            inCardAccount: reservation.hostAccount,
            inTransactionAccount: reservation.hostAccount,
          },
        };
      },
      requiredFields: [
        "inBankNumber",
        "inCardAccount",
        "inTransactionAccount",
      ],
      requiresPin: false,
      version: "1",
    };
    registry.register(mapper);
    const assembler = createAssembler(registry);

    const result = await assembler.assemble({
      amount: 500,
      assessment: { entryMethodId: "reservation.code" },
      materials: {
        authentication: {},
        credential: {
          entryMethodId: "reservation.code",
          material: {
            bankNumber: "807",
            hostAccount: "0000000012345678",
            reservationPassword: "MUST-NOT-LEAK",
          },
        },
      },
      operationId: "operation-cardless",
    });

    expect(result.entryMode).toBe("cardless-reservation");
    expect(result.bspContext.ici.inTransactionAmount).toBe("00000500");
    expect(JSON.stringify(result.safeMetadata)).not.toContain(
      "MUST-NOT-LEAK",
    );
  });

  it("rejects unsuccessful or malformed IDC material with a safe error", async () => {
    const assembler = createAssembler(createContactRegistry());
    const input = contactInput();

    const failure = await assembler
      .assemble({
        ...input,
        materials: {
          ...input.materials,
          credential: {
            entryMethodId: "card.contact",
            material: {
              kind: "card",
              raw: {
                cardData: [
                  {
                    data: new TextEncoder().encode(TRACK3),
                    dataSource: TRACK3_SOURCE,
                    status: 7,
                  },
                ],
              },
            },
          },
        },
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "BSP_CREDENTIAL_INVALID",
      fieldId: "credential",
    });
    expect(JSON.stringify(failure)).not.toContain(TRACK3);
  });
});

function createContactRegistry(): BspCredentialMapperRegistry {
  const registry = new BspCredentialMapperRegistry();
  registry.register(
    createBspXfsIdcCredentialMapper({
      entryMethodIds: ["card.contact"],
      id: "taiwan-bsp.xfs-idc",
      requiredSources: [TRACK3_SOURCE],
      resolve: (card) => ({
        ici: {
          inBankNumber: "807",
          inCardAccount: CARD_ACCOUNT,
          inTrack3: card.requireText(TRACK3_SOURCE),
          inTransactionAccount: TRANSACTION_ACCOUNT,
        },
      }),
      version: "2.43",
    }),
  );
  return registry;
}

function createAssembler(
  credentialMappers: BspCredentialMapperRegistry,
  protect: () => {
    readonly mac: string;
    readonly terminalCheck: string;
  } = () => ({ mac: "A1B2C3D4", terminalCheck: "87654321" }),
): BspV243OperationContextAssembler {
  return new BspV243OperationContextAssembler({
    clock: {
      currentDates: () => ({
        businessDate: "20260724",
        macDate: "260724",
        systemDate: "20260724",
      }),
    },
    credentialMappers,
    security: { protect },
    sequence: { next: () => 175 },
    terminal: {
      atmId: "00001",
      currencyCode: "00",
      deviceStatus: "000000000000",
      mode: "1",
      serviceStatus: "0",
      transmissionArea: "  ",
      versionDate: "20260206",
      versionMarker: "V",
    },
  });
}

function contactInput() {
  return {
    amount: 1_000,
    assessment: { entryMethodId: "card.contact" },
    materials: {
      authentication: {
        "pin.online": {
          encryptedPinBlock: PIN_BLOCK,
          kind: "securePin",
          safeSummary: { present: true },
        },
      },
      credential: {
        entryMethodId: "card.contact",
        material: {
          kind: "card",
          raw: {
            cardData: [
              {
                data: new TextEncoder().encode(TRACK3),
                dataSource: TRACK3_SOURCE,
                status: 0,
              },
            ],
          },
        },
      },
    },
    operationId: "operation-contact",
  };
}

function iciWirePrefix(ici: Readonly<Record<string, string>>): string {
  const throughAmount = bspWithdrawalIciLayout.findIndex(
    (field) => field.id === "inTransactionAmount",
  );
  return bspWithdrawalIciLayout
    .slice(0, throughAmount + 1)
    .map((field) => {
      const value = ici[field.id] ?? "";
      return "numeric" in field && field.numeric === true
        ? value.padStart(field.bytes, "0")
        : value.padEnd(field.bytes, " ");
    })
    .join("");
}
