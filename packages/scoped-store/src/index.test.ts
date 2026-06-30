import { describe, expect, it } from "vitest";
import { MemoryScopedStore } from "./index";

describe("MemoryScopedStore", () => {
  it("supports get/set/getOrCreate/patch/remove in a scoped view", () => {
    const store = new MemoryScopedStore();
    const view = store.scope("transaction");

    view.set("transactionId", "tx-1");
    expect(view.getOrThrow("transactionId")).toBe("tx-1");
    expect(view.getOrCreate("summary", () => ({ amount: 100 }))).toEqual({ amount: 100 });
    view.patch<{ amount: number; currency?: string }>("summary", { currency: "CNY" });
    expect(view.get("summary")).toEqual({ amount: 100, currency: "CNY" });
    view.remove("transactionId");
    expect(view.keys()).toEqual(["summary"]);
  });

  it("resets transaction without clearing application or session values", async () => {
    const store = new MemoryScopedStore();
    store.scope("application").set("app", "keep");
    store.scope("session").set("language", "zh-CN");
    store.scope("transaction").set("transactionId", "tx-1");
    store.scope("flow", "flow-1").set("step", "amount");
    store.scope("node", "node-1").set("input", "100");

    await store.resetTransaction("finished");

    expect(store.scope("application").get("app")).toBe("keep");
    expect(store.scope("session").get("language")).toBe("zh-CN");
    expect(store.scope("transaction").get("transactionId")).toBeUndefined();
    expect(store.scope("flow", "flow-1").get("step")).toBeUndefined();
    expect(store.scope("node", "node-1").get("input")).toBeUndefined();
  });

  it("resets session and all lower lifecycle scopes", async () => {
    const store = new MemoryScopedStore();
    store.scope("application").set("app", "keep");
    store.scope("session").set("language", "zh-CN");
    store.scope("transaction").set("transactionId", "tx-1");

    await store.resetSession("session-ended");

    expect(store.scope("application").get("app")).toBe("keep");
    expect(store.scope("session").get("language")).toBeUndefined();
    expect(store.scope("transaction").get("transactionId")).toBeUndefined();
  });
});
