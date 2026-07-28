import { describe, expect, it } from "vitest";

import { createCardReaderInputSourceAdapter } from "./card-input";
import { DeviceRegistry } from "./devices";
import { createReplayableInputSourceProgress } from "./input-progress";
import type { InputSourceExecutionContext } from "./input-sources";
import { DeviceLockManager } from "./locks";
import {
  CorrelatedInputSourceBroker,
  type InputInteractionIdentity,
} from "./programmatic-input";

describe("CorrelatedInputSourceBroker", () => {
  it("rejects stale, duplicate, and unauthorized submissions without altering active input", async () => {
    const broker = new CorrelatedInputSourceBroker();
    const adapter = broker.createAdapter();
    const identity = interaction("current");
    const session = await adapter.start(context(identity), {
      id: "menu",
      kind: "ui.command",
      options: { allowedIntentIds: ["menu.select"], identity },
    });

    expect(() =>
      broker.submit({
        identity: interaction("stale"),
        intentId: "menu.select",
      }),
    ).toThrowError(/stale interaction/i);
    expect(() =>
      broker.submit({ identity, intentId: "menu.forbidden" }),
    ).toThrowError(/not allowed/i);

    broker.submit({
      identity,
      intentId: "menu.select",
      payload: "balance",
    });
    await expect(session.result).resolves.toMatchObject({
      safeSummary: { intentId: "menu.select" },
      value: "balance",
    });
    expect(() =>
      broker.submit({ identity, intentId: "menu.select" }),
    ).toThrowError(/matching programmatic input/i);
  });

  it("supports independent channels and bounds completed interaction evidence", async () => {
    const broker = new CorrelatedInputSourceBroker({
      completedInteractionRetention: 1,
    });
    const adapter = broker.createAdapter();
    const first = interaction("first", "customer");
    const second = interaction("second", "operator");
    const firstSession = await adapter.start(context(first), definition(first));
    const secondSession = await adapter.start(
      context(second),
      definition(second),
    );

    broker.submit({ identity: first, intentId: "confirm" });
    broker.submit({ identity: second, intentId: "confirm" });
    await Promise.all([firstSession.result, secondSession.result]);

    expect(broker.completedInteractionCount).toBe(1);
  });
});

describe("input progress and card adapter", () => {
  it("replays the latest safe progress to a late subscriber", () => {
    const progress = createReplayableInputSourceProgress();
    progress.publish({
      activity: true,
      kind: "pinpad.digitCount",
      safeSummary: { digitCount: 2 },
    });
    const observed: unknown[] = [];

    progress.subscribe((value) => observed.push(value.safeSummary));

    expect(observed).toEqual([{ digitCount: 2 }]);
  });

  it("wraps custom card material with a safe summary and propagates cancellation", async () => {
    const devices = new DeviceRegistry();
    const cancels: unknown[] = [];
    devices.register("customCard", {
      descriptor: {
        capabilities: ["card.read"],
        id: "customCard",
        type: "cardReader",
      },
      port: {
        cancel: async (...input: unknown[]) => {
          cancels.push(input);
        },
        readCard: async () => ({
          rawTrack: "SECRET",
          safeSummary: { technology: "contact" },
        }),
      },
    });
    const adapter = createCardReaderInputSourceAdapter("customCard");
    const session = await adapter.start(
      { ...baseContext(), devices },
      { id: "card", kind: "cardReader.card" },
    );

    await expect(session.result).resolves.toMatchObject({
      safeSummary: {
        sourceKind: "cardReader.card",
        technology: "contact",
      },
    });
    await session.cancel("node.exit");

    expect(cancels).toHaveLength(1);
    expect(JSON.stringify((await session.result).safeSummary)).not.toContain(
      "SECRET",
    );
  });
});

const interaction = (
  interactionId: string,
  channelId = "customer",
): InputInteractionIdentity => ({
  channelId,
  flowInstanceId: `flow-${interactionId}`,
  interactionId,
  nodeId: "menu",
});

const definition = (identity: InputInteractionIdentity) => ({
  id: "menu",
  kind: "ui.command" as const,
  options: { allowedIntentIds: ["confirm"], identity },
});

const context = (
  identity: InputInteractionIdentity,
): InputSourceExecutionContext => ({
  ...baseContext(),
  instanceId: identity.flowInstanceId,
  nodeId: identity.nodeId,
});

const baseContext = (): InputSourceExecutionContext => ({
  deviceLocks: new DeviceLockManager(),
  devices: new DeviceRegistry(),
  flowId: "test.flow",
  flowVersion: "1.0.0",
  instanceId: "flow",
  nodeId: "node",
});
