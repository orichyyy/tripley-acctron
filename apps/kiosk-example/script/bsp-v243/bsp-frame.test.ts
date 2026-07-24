import { describe, expect, it } from "vitest";

import { createBspV243FrameCodec } from "./bsp-frame";

const ascii = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("Taiwan BSP v2.43 common frame header", () => {
  it("writes all six shared request header fields and the complete buffer length", () => {
    const frame = createBspV243FrameCodec().encode(new Uint8Array(720).fill(0x20));

    expect(frame).toHaveLength(732);
    expect([...frame.slice(0, 3)]).toEqual([0x0f, 0x0f, 0x0f]);
    expect([...frame.slice(3, 6)]).toEqual([0x00, 0x07, 0x32]);
    expect(frame[6]).toBe(0x01);
    expect(ascii(frame.slice(7, 10))).toBe("000");
    expect([...frame.slice(10, 12)]).toEqual([0x0f, 0x0f]);
  });

  it("increments the ASCII request counter and wraps after 999", () => {
    const codec = createBspV243FrameCodec();

    expect(ascii(codec.encode(Uint8Array.of(1)).slice(7, 10))).toBe("000");
    for (let expected = 1; expected <= 999; expected += 1) {
      const encoded = codec.encode(Uint8Array.of(1));
      expect(ascii(encoded.slice(7, 10))).toBe(String(expected).padStart(3, "0"));
    }
    expect(ascii(codec.encode(Uint8Array.of(1)).slice(7, 10))).toBe("000");
  });

  it("strips the complete shared response header before routing the message body", () => {
    const codec = createBspV243FrameCodec();
    const body = Uint8Array.of(0x4f, 0x45, 0x58);
    const framed = codec.encode(body);

    expect(codec.decode(framed)).toEqual({
      consumedBytes: 15,
      payload: body,
      status: "complete",
    });
  });

  it.each([
    [6, 0x02],
    [7, 0x41],
    [10, 0x00],
    [11, 0x00],
  ])("rejects an invalid shared response header byte at offset %i", (offset, value) => {
    const codec = createBspV243FrameCodec();
    const framed = codec.encode(Uint8Array.of(1));
    framed[offset] = value;

    expect(codec.decode(framed)).toEqual({
      errorCode: "bsp.v243.frame-header-invalid",
      status: "invalid",
    });
  });
});
