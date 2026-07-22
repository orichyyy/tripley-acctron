import { describe, expect, it } from "vitest";

import { createAsciiLengthPrefixFrameCodec, createLengthPrefixFrameCodec } from "./framing";

describe("host channel framing", () => {
  it("frames and incrementally decodes the simulator ASCII length protocol", () => {
    const codec = createAsciiLengthPrefixFrameCodec({
      lengthIncludesPrefix: false,
      maxFrameBytes: 64,
      prefixBytes: 4,
    });
    const body = new TextEncoder().encode("E1234560000");
    const framed = codec.encode(body);

    expect(new TextDecoder().decode(framed)).toBe("0011E1234560000");
    expect(codec.decode(framed.slice(0, 8))).toEqual({ status: "incomplete" });
    expect(codec.decode(framed)).toEqual({
      consumedBytes: 15,
      payload: body,
      status: "complete",
    });
  });

  it("frames the production simulator fixed-header BCD length protocol", () => {
    const codec = createLengthPrefixFrameCodec({
      fixedHeader: Uint8Array.of(0x0f, 0x0f, 0x0f),
      lengthBytes: 3,
      lengthEncoding: "bcd",
      lengthIncludesFixedHeader: true,
      lengthIncludesLengthField: true,
      maxFrameBytes: 64,
    });
    const body = new TextEncoder().encode("AEX-request");
    const framed = codec.encode(body);

    expect([...framed.slice(0, 6)]).toEqual([0x0f, 0x0f, 0x0f, 0, 0, 0x17]);
    expect(codec.decode(framed.slice(0, 8))).toEqual({ status: "incomplete" });
    expect(codec.decode(framed)).toEqual({
      consumedBytes: 17,
      payload: body,
      status: "complete",
    });
  });
});
