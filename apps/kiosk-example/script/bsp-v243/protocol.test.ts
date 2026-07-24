import type { HostSessionControlContext } from "@tripley-kit/web-container-kiosk-host-session";
import { describe, expect, it, vi } from "vitest";

import { createBspV243SessionProfile } from "./composition";
import { packOexResponse, terminalSnapshot } from "./test-fixture";

describe("Taiwan BSP v2.43 session protocol", () => {
  it("establishes readiness with OEX B001 and no invented client heartbeat", async () => {
    const profile = createBspV243SessionProfile({ terminalState: () => terminalSnapshot });
    const exchange = vi.fn(async () => ({
      payload: packOexResponse(profile.messages),
      responseId: "oex-response",
      status: "response" as const,
    }));
    const result = await profile.protocol.establish(context(exchange));

    expect(result).toEqual({ status: "accepted" });
    expect(profile.protocol.heartbeat).toBeUndefined();
    expect(exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "bsp.primary",
        idempotencyKey: "bsp-v243:oex:7:2026072400000001",
        timeoutMs: 15_000,
      }),
    );
  });

  it("maps malformed and uncertain responses to stable safe errors", async () => {
    const profile = createBspV243SessionProfile({ terminalState: () => terminalSnapshot });

    await expect(
      profile.protocol.establish(
        context(async () => ({ status: "unknown", errorCode: "secret-network-detail" })),
      ),
    ).resolves.toEqual({ status: "failed", errorCode: "bsp.v243.oex.transport-unknown" });
    await expect(
      profile.protocol.establish(
        context(async () => ({ payload: Uint8Array.of(1), responseId: "bad", status: "response" })),
      ),
    ).resolves.toEqual({ status: "failed", errorCode: "bsp.v243.oex.response-invalid" });
  });
});

const context = (exchange: HostSessionControlContext["exchange"]): HostSessionControlContext => ({
  exchange,
  generation: 7,
  sessionId: "bsp.primary",
  signal: new AbortController().signal,
});
