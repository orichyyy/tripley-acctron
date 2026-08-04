import { describe, expect, it, vi } from "vitest";

import { runXfsPinDataCrypt } from "./pinpad-crypt";

describe("runXfsPinDataCrypt", () => {
  it("encrypts preformatted data without exposing key or input bytes in its summary", async () => {
    const crypt = vi.fn(async () => ({
      data: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01, 0x02]),
      native: { hResult: 0 },
    }));
    const input = new Uint8Array([0x06, 0x12, 0x47, 0xc6, 0xfe, 0xfe, 0xff, 0xef]);

    const result = await runXfsPinDataCrypt(
      { crypt },
      "pin-session",
      10_000,
      {
        algorithm: "tripleDesEcb",
        data: input,
        keyName: "PINKEY",
        mode: "encrypt",
      },
    );

    expect(crypt).toHaveBeenCalledWith(expect.objectContaining({
      algorithm: 64,
      compression: 0,
      cryptData: input,
      keyName: "PINKEY",
      mode: 1,
      padding: 0,
    }));
    expect(result.data).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01, 0x02]));
    expect(JSON.stringify(result.safeSummary)).not.toContain("PINKEY");
    expect(JSON.stringify(result.safeSummary)).not.toContain("061247c6");
  });
});
