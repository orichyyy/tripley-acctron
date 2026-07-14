import { describe, expect, it } from "vitest";
import { concatBytes, hexToBytes } from "./bytes";
import { createHostMessageService } from "./service";
import { isoProfile } from "./test-fixtures";

const authorizationRef = { profileId: "fixture.iso1987", profileVersion: "1", messageId: "authorization.request" } as const;

describe("Iso8583MessageCodec", () => {
  it("matches an ISO 8583 primary bitmap golden vector", () => {
    const { service } = createHostMessageService({ profiles: [isoProfile] });
    const expected = concatBytes([
      new TextEncoder().encode("0200"),
      hexToBytes("7020000000000000") ?? new Uint8Array(),
      new TextEncoder().encode("164111111111111111010000000000001000123456"),
    ]);
    const fields = {
      pan: "4111111111111111",
      processingCode: "010000",
      amount: "000000001000",
      stan: "123456",
    };

    const packed = service.pack({ reference: authorizationRef, fields });
    expect(packed.status).toBe("packed");
    if (packed.status !== "packed") return;
    expect(packed.message.bytes).toEqual(expected);

    const decoded = service.unpack({ reference: authorizationRef, bytes: expected });
    expect(decoded.status).toBe("complete");
    if (decoded.status === "complete") expect(decoded.message.fields).toEqual(fields);
  });

  it("supports BCD MTI, ASCII-hex secondary bitmap, and BCD LLLVAR length", () => {
    const { service } = createHostMessageService({ profiles: [isoProfile] });
    const reference = { profileId: "fixture.iso1987", profileVersion: "1", messageId: "network.request" } as const;
    const packed = service.pack({ reference, fields: { privateData: "HELLO", networkCode: "301" } });

    expect(packed.status).toBe("packed");
    if (packed.status !== "packed") return;
    expect(packed.message.bytes.slice(0, 2)).toEqual(hexToBytes("0800"));
    expect(new TextDecoder().decode(packed.message.bytes.slice(2, 34))).toBe("80000000000100000400000000000000");
    expect(packed.message.bytes.slice(34, 36)).toEqual(hexToBytes("0005"));
    expect(service.unpack({ reference, bytes: packed.message.bytes }).status).toBe("complete");
  });

  it("hard-fails an undefined bitmap field instead of returning partial", () => {
    const { service } = createHostMessageService({ profiles: [isoProfile], allowPartial: true });
    const bytes = concatBytes([
      new TextEncoder().encode("0200"),
      hexToBytes("7020000000000002") ?? new Uint8Array(),
    ]);
    const result = service.unpack({ reference: authorizationRef, bytes });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error.code).toBe("hostMessage.iso.undefinedDataElement");
  });
});
