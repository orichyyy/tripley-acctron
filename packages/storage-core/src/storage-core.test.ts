import { describe, expect, it } from "vitest";
import { InMemoryConfigKvStore, InMemoryCounterService } from "./index";

describe("InMemoryCounterService", () => {
  it("increments counters atomically through the service", async () => {
    const counters = new InMemoryCounterService();

    const results = await Promise.all([
      counters.increment("kiosk", "receipt"),
      counters.increment("kiosk", "receipt"),
      counters.incrementBy("kiosk", "receipt", 3),
    ]);

    expect(results.sort((left, right) => left - right)).toEqual([1, 2, 5]);
    await expect(counters.get("kiosk", "receipt")).resolves.toBe(5);
  });
});

describe("InMemoryConfigKvStore", () => {
  it("stores and reads typed values", async () => {
    const kv = new InMemoryConfigKvStore();

    const numberRecord = await kv.set("device", "withdrawal.maxAmount", 20000, {
      schemaId: "withdrawal-limit",
    });
    await kv.set("device", "features", { receipt: true });

    expect(numberRecord).toMatchObject({
      key: "withdrawal.maxAmount",
      schemaId: "withdrawal-limit",
      valueJson: "20000",
      valueType: "number",
    });
    await expect(kv.get<number>("device", "withdrawal.maxAmount")).resolves.toBe(20000);
    await expect(kv.get("device", "features")).resolves.toEqual({ receipt: true });
  });
});
