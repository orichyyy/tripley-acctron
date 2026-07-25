import { describe, expect, it } from "vitest";

import { BspOperationContextError } from "./operation-context-contracts";
import { createTaiwanBspContactCardContextAssembler } from "./taiwan-contact-card-context";

const TRACK2 = "4761739001010010=25122010000000000000";
const PIN_BLOCK = "0123456789ABCDEF";

describe("Taiwan BSP contact-card project context", () => {
  it("projects simulator IDC and secure PIN material without unsafe metadata", async () => {
    const assembler = createAssembler();

    const result = await assembler.assemble(operationInput(TRACK2));

    expect(result.bspContext.ici).toMatchObject({
      inBankNumber: "807",
      inCardAccount: "4761739001010010",
      inMac: "00000000",
      inPinBlock: PIN_BLOCK,
      inTerminalCheck: "00000000",
      inTrack3: TRACK2,
      inTransactionAccount: "0000000000000058",
      inTransactionAmount: "00000100",
    });
    expect(result.entryMode).toBe("contact-card");
    const safeMetadata = JSON.stringify(result.safeMetadata);
    expect(safeMetadata).not.toContain(TRACK2);
    expect(safeMetadata).not.toContain(PIN_BLOCK);
  });

  it("rejects malformed Track 2 without retaining its value", async () => {
    const malformed = "SECRET-NOT-A-TRACK";
    const failure = await createAssembler()
      .assemble(operationInput(malformed))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BspOperationContextError);
    expect(failure).toMatchObject({
      code: "BSP_FIELD_INVALID",
      fieldId: "inCardAccount",
    });
    expect(JSON.stringify(failure)).not.toContain(malformed);
  });
});

function createAssembler() {
  return createTaiwanBspContactCardContextAssembler({
    bankNumber: "807",
    clock: {
      currentDates: () => ({
        businessDate: "01150724",
        macDate: "150724",
        systemDate: "01150724",
      }),
    },
    resolveTransactionAccount: () => "0000000000000058",
    security: {
      protect: () => ({
        mac: "00000000",
        terminalCheck: "00000000",
      }),
    },
    sequence: { next: () => "00000176" },
    terminal: {
      atmId: "00000",
      currencyCode: "01",
      deviceStatus: "000000030000",
      mode: "1",
      serviceStatus: "1",
      transmissionArea: "  ",
      versionDate: "20260723",
      versionMarker: "A",
    },
    track2Source: 2,
  });
}

function operationInput(track2: string) {
  return {
    amount: 100,
    assessment: { entryMethodId: "card.contact" },
    materials: {
      authentication: {
        "pin.online": {
          encryptedPinBlock: PIN_BLOCK,
          kind: "securePin",
          safeSummary: { hasEncryptedPinBlock: true },
        },
      },
      credential: {
        entryMethodId: "card.contact",
        material: {
          kind: "card",
          raw: {
            cardData: [{
              data: new TextEncoder().encode(track2),
              dataSource: 2,
              status: 0,
            }],
          },
        },
      },
    },
    operationId: "target62-project-context",
  };
}
