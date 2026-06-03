import { describe, expect, test } from "vitest";
import { createFakeDevices } from "./fake-devices";

describe("fake devices", () => {
  test("card reader waits for card and records retain", async () => {
    const devices = createFakeDevices();
    const wait = devices.cardReader.waitForCard();

    devices.cardReader.insert({ pan: "4111111111111111" });

    await expect(wait).resolves.toEqual({ pan: "4111111111111111" });
    await devices.cardReader.retain("device failure");

    expect(devices.cardReader.retainedReasons).toEqual(["device failure"]);
  });

  test("cash dispenser records dispense and retract", async () => {
    const devices = createFakeDevices();

    await expect(devices.cashDispenser.dispense({ amount: 100, currency: "USD" })).resolves.toEqual(
      {
        dispensed: true,
        amount: 100,
        currency: "USD",
      },
    );
    await devices.cashDispenser.retract();

    expect(devices.cashDispenser.dispenseRequests).toEqual([{ amount: 100, currency: "USD" }]);
    expect(devices.cashDispenser.retracted).toBe(true);
  });

  test("printer records print and cut", async () => {
    const devices = createFakeDevices();

    await devices.printer.print({ text: "receipt", cut: true });
    await devices.printer.cut();

    expect(devices.printer.prints).toEqual([{ text: "receipt", cut: true }]);
    expect(devices.printer.cuts).toBe(2);
  });
});
