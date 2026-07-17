import { describe, expect, it } from "vitest";

import { MemoryScopedStore } from "./index";

describe("MemoryScopedStore transaction reset", () => {
  it("clears every operation-keyed transaction scope", async () => {
    const store = new MemoryScopedStore();
    store.scope("transaction", "operation-1").set("amount", 100);
    store.scope("transaction", "operation-2").set("amount", 200);

    await store.resetTransaction("operation.completed");

    expect(store.scope("transaction", "operation-1").keys()).toEqual([]);
    expect(store.scope("transaction", "operation-2").keys()).toEqual([]);
    expect(store.listClearHistory()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "operation-1", reason: "operation.completed" }),
        expect.objectContaining({ id: "operation-2", reason: "operation.completed" }),
      ]),
    );
  });
});
