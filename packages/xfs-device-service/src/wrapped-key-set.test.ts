import { describe, expect, it, vi } from "vitest";

import { importXfsWrappedKeySet } from "./wrapped-key-set";

describe("importXfsWrappedKeySet", () => {
  it("returns committed only after every wrapped key import succeeds", async () => {
    const importKey = vi.fn()
      .mockResolvedValueOnce({ native: { hResult: 0 } })
      .mockResolvedValueOnce({ native: { hResult: 0 } });

    await expect(importXfsWrappedKeySet(
      { importKey },
      "pin-session",
      10_000,
      keySet(),
    )).resolves.toMatchObject({ committed: true, importedKeyCount: 2 });
    expect(importKey).toHaveBeenCalledTimes(2);
  });

  it("fails closed without exposing wrapped key material when one import fails", async () => {
    const importKey = vi.fn()
      .mockResolvedValueOnce({ native: { hResult: 0 } })
      .mockResolvedValueOnce({ native: { hResult: -1 } });
    const keys = keySet();

    const failure = await importXfsWrappedKeySet(
      { importKey },
      "pin-session",
      10_000,
      keys,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "xfs.pin.keySetImport.failed",
      metadata: {
        failedKeyIndex: 1,
        hResult: -1,
        importedKeyCount: 1,
        keyCount: 2,
      },
    });
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(Buffer.from(keys.keys[0]!.value).toString("hex"));
    expect(serialized).not.toContain("PINKEY");
  });
});

const keySet = () => ({
  keys: [
    {
      encryptionKeyName: "MASTERKEY",
      keyName: "PINKEY",
      useFlags: 1,
      value: new Uint8Array([1, 2, 3, 4]),
      verificationData: new Uint8Array([5, 6]),
    },
    {
      encryptionKeyName: "MASTERKEY",
      keyName: "MACKEY",
      useFlags: 4,
      value: new Uint8Array([7, 8, 9, 10]),
      verificationData: new Uint8Array([11, 12]),
    },
  ],
});
