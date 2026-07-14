import { describe, expect, it } from "vitest";
import { createHostMessageService } from "./service";
import { fixedProfile } from "./test-fixtures";

const reference = { profileId: "fixture.fixed", profileVersion: "1", messageId: "authorization.request" } as const;

describe("FixedFieldMessageCodec", () => {
  it("packs and unpacks an independent fixed-field golden vector", () => {
    const { service } = createHostMessageService({ profiles: [fixedProfile] });
    const fields = {
      messageType: "E",
      trace: "123456",
      amount: "000000001000",
      accounts: [
        { account: "A001", balance: "0100" },
        { account: "A002", balance: "0200" },
      ],
    } as const;
    const expected = new TextEncoder().encode("E12345600000000100002A0010100A0020200");

    const packed = service.pack({ reference, fields });
    expect(packed.status).toBe("packed");
    if (packed.status !== "packed") return;
    expect(packed.message.bytes).toEqual(expected);

    const decoded = service.unpack({ reference, bytes: expected });
    expect(decoded.status).toBe("complete");
    if (decoded.status !== "complete") return;
    expect(decoded.message.fields).toEqual({ ...fields, accountCount: "02" });
  });

  it("returns complete leading fields and the failed field location", () => {
    const { service } = createHostMessageService({ profiles: [fixedProfile] });
    const truncated = new TextEncoder().encode("E1234560000");
    const result = service.unpack({ reference, bytes: truncated, allowPartial: true });

    expect(result.status).toBe("partial");
    if (result.status !== "partial") return;
    expect(result.fields).toEqual({ messageType: "E", trace: "123456" });
    expect(result.failure.fieldId).toBe("amount");
    expect(result.failure.expectedBytes).toBe(12);
  });

  it("uses per-call false to override a project partial default", () => {
    const { service } = createHostMessageService({ profiles: [fixedProfile], allowPartial: true });
    const result = service.unpack({ reference, bytes: new TextEncoder().encode("E12"), allowPartial: false });
    expect(result.status).toBe("failed");
  });

  it("rejects trailing bytes and excessive repeat counts", () => {
    const { service } = createHostMessageService({ profiles: [fixedProfile] });
    const trailing = service.unpack({ reference, bytes: new TextEncoder().encode("E12345600000000100000                X") });
    expect(trailing.status).toBe("failed");

    const packed = service.pack({
      reference,
      fields: {
        messageType: "E",
        trace: "123456",
        amount: "000000001000",
        accounts: [
          { account: "A001", balance: "0100" },
          { account: "A002", balance: "0200" },
          { account: "A003", balance: "0300" },
        ],
      },
    });
    expect(packed.status).toBe("failed");
  });
});
