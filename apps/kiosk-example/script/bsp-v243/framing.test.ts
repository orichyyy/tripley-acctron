import { describe, expect, it } from "vitest";

import { createBspV243FrameCodec } from "./framing";

describe("Taiwan BSP v2.43 shared transport header", () => {
  it("adds all six shared headers and the complete buffer length", () => {
    const codec = createBspV243FrameCodec();
    const frame = codec.encode(new Uint8Array(720).fill(0x20));

    expect(frame).toHaveLength(732);
    expect([...frame.slice(0, 7)]).toEqual([
      0x0f,
      0x0f,
      0x0f,
      0x00,
      0x07,
      0x32,
      0x01,
    ]);
    expect(new TextDecoder().decode(frame.slice(7, 10))).toBe("000");
    expect([...frame.slice(10, 12)]).toEqual([0x0f, 0x0f]);
  });

  it("increments HEADER_4 from 000 through 999 and wraps", () => {
    const codec = createBspV243FrameCodec({ initialCounter: 998 });
    const counters = Array.from(
      { length: 4 },
      () => new TextDecoder().decode(codec.encode(new Uint8Array(1)).slice(7, 10)),
    );
    expect(counters).toEqual(["998", "999", "000", "001"]);
  });

  it("strips the shared response header before message decoding", () => {
    const codec = createBspV243FrameCodec({ initialCounter: 41 });
    const payload = new Uint8Array(720).fill(0x20);
    const frame = codec.encode(payload);

    expect(codec.decode(frame)).toEqual({
      consumedBytes: 732,
      payload,
      status: "complete",
    });
    expect(codec.decode(frame.slice(0, 731))).toEqual({ status: "incomplete" });
  });

  it("rejects invalid shared control fields", () => {
    const codec = createBspV243FrameCodec();
    const frame = codec.encode(new Uint8Array(720));
    frame[6] = 0x02;
    expect(codec.decode(frame)).toEqual({
      errorCode: "bsp.v243.frame-header-3-invalid",
      status: "invalid",
    });
  });
});
