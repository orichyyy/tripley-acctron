import { describe, expect, it, vi } from "vitest";

import { CorrelatedInputCompletionBroker } from "./input-completion";
import { createReplayableInputSourceProgress } from "./input-progress";
import type { InputSourceSession, UserInputSourceResult } from "./input-sources";

describe("CorrelatedInputCompletionBroker", () => {
  it("keeps input pending below minLength and completes the correlated session", async () => {
    const broker = new CorrelatedInputCompletionBroker();
    const progress = createReplayableInputSourceProgress();
    const complete = vi.fn(async () => undefined);
    const session = pendingSession(progress, complete);
    broker.register({ identity, minLength: 6, session });

    progress.publish(safeDigitCount(5));
    await expect(broker.complete({ identity, sourceKind: "pinpad.pin" })).resolves.toEqual({
      accepted: false,
      reasonCode: "INPUT.MIN_LENGTH",
      safeSummary: { digitCount: 5, minLength: 6, sourceKind: "pinpad.pin" },
    });
    expect(complete).not.toHaveBeenCalled();

    progress.publish(safeDigitCount(6));
    await expect(broker.complete({ identity, sourceId: "pinpad" })).resolves.toEqual({
      accepted: true,
    });
    expect(complete).toHaveBeenCalledWith("ui.confirm");
  });

  it("rejects stale completion identities", async () => {
    const broker = new CorrelatedInputCompletionBroker();
    broker.register({
      identity,
      session: pendingSession(createReplayableInputSourceProgress(), vi.fn()),
    });

    await expect(broker.complete({
      identity: { ...identity, interactionId: "stale" },
      sourceKind: "pinpad.pin",
    })).rejects.toMatchObject({ code: "inputCompletion.noPending" });
  });
});

const identity = {
  flowInstanceId: "flow-1",
  interactionId: "flow-1.pin.1",
  nodeId: "pin",
};

const pendingSession = (
  progress: ReturnType<typeof createReplayableInputSourceProgress>,
  complete: (reason?: string) => Promise<void>,
): InputSourceSession => ({
  cancel: async () => undefined,
  complete,
  id: "session.pin",
  progress,
  result: new Promise<UserInputSourceResult>(() => undefined),
  sourceId: "pinpad",
  sourceKind: "pinpad.pin",
});

const safeDigitCount = (digitCount: number) => ({
  activity: true,
  kind: "pinpad.digitCount",
  safeSummary: { digitCount },
});
