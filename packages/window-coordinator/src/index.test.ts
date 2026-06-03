import { describe, expect, it } from "vitest";
import { ServiceStateController } from "@tripley-acctron/runtime-core";
import { MemoryCoordinatorChannel, RuntimeCoordinator } from "./index.js";

describe("MemoryCoordinatorChannel", () => {
  it("broadcasts coordinator snapshots", async () => {
    const channel = new MemoryCoordinatorChannel();
    const snapshots: string[] = [];
    channel.subscribeSnapshot((snapshot) => snapshots.push(snapshot.availability));
    await channel.publishSnapshot({ availability: "in-service", transactionPhase: "idle" });
    expect(snapshots).toEqual(["in-service"]);
  });

  it("applies supervisor commands through the main coordinator", async () => {
    const state = new ServiceStateController();
    const channel = new MemoryCoordinatorChannel();
    const coordinator = new RuntimeCoordinator(state, channel);
    await coordinator.start();
    await channel.publishCommand({ kind: "enter-maintenance" });
    expect(state.getSnapshot().availability).toBe("maintenance");
  });
});
