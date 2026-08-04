import { describe, expect, it, vi } from "vitest";

import { XfsPinpadDevicePort } from "./pinpad-device-port";
import type { XfsPinClientLike, XfsPinEventLike } from "./types";

describe("XfsPinpadDevicePort controlled completion", () => {
  it("cancels GET_PIN without reset and continues with GET_PINBLOCK", async () => {
    const fixture = pinFixture();
    const result = fixture.port.getPin(
      { customerData: "000012345678", minLength: 6, maxLength: 12 },
      { operationId: "flow.pin.1" },
    );
    await fixture.emitDigits(6);

    await fixture.port.complete("flow.pin.1");

    await expect(result).resolves.toMatchObject({
      encryptedPinBlock: "010203",
      kind: "securePin",
    });
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.reset).not.toHaveBeenCalled();
    expect(fixture.getPinblock).toHaveBeenCalledOnce();
  });

  it("rejects UI completion below the configured minimum without ending input", async () => {
    const fixture = pinFixture();
    const result = fixture.port.getPin(
      { customerData: "000012345678", minLength: 6, maxLength: 12 },
      { operationId: "flow.pin.2" },
    );
    await fixture.emitDigits(5);

    await expect(fixture.port.complete("flow.pin.2")).rejects.toMatchObject({
      code: "xfs.pin.input.minLength",
    });
    expect(fixture.cancel).not.toHaveBeenCalled();

    await fixture.emitDigits(1);
    await fixture.port.complete("flow.pin.2");
    await expect(result).resolves.toMatchObject({ kind: "securePin" });
  });
});

const pinFixture = () => {
  let eventHandler: ((event: XfsPinEventLike) => void | Promise<void>) | undefined;
  let resolvePin!: (value: { digits: number; native: { hResult: number } }) => void;
  const getPinblock = vi.fn(async () => ({
    data: new Uint8Array([1, 2, 3]),
    native: { hResult: 0 },
  }));
  const reset = vi.fn(async () => ({ native: { hResult: 0 } }));
  const client: XfsPinClientLike = {
    getData: async () => ({ native: { hResult: 0 } }),
    getPin: async () => new Promise((resolve) => { resolvePin = resolve; }),
    getPinblock,
    getStatus: async () => ({ native: { hResult: 0 } }),
    reset,
    subscribeEvent: (handler) => {
      eventHandler = handler;
      return { unsubscribe: () => undefined };
    },
  };
  const cancel = vi.fn(async () => {
    resolvePin({ digits: 6, native: { hResult: -4 } });
    return { hResult: 0 };
  });
  const port = new XfsPinpadDevicePort({
    client,
    commandLeases: { run: async (_execution, command) => command() },
    deviceId: "pinpad",
    logicalName: "PINPAD",
    manager: {
      cancelAsyncRequest: cancel,
      close: async () => undefined,
      open: async () => { throw new Error("not used"); },
      startup: async () => undefined,
    },
    session: { id: "pin-session" },
    timeoutMs: 30_000,
  });
  return {
    cancel,
    emitDigits: async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await eventHandler?.({ data: { kind: "key", value: { completion: 6, digit: 0 } } });
      }
    },
    getPinblock,
    port,
    reset,
  };
};
