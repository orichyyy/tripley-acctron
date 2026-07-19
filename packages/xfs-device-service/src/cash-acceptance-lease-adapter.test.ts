import { describe, expect, it, vi } from "vitest";

import { XfsCashAcceptanceLeaseAdapter } from "./cash-acceptance-lease-adapter";

describe("XfsCashAcceptanceLeaseAdapter", () => {
  it("binds the configured owner and resource group and releases once", async () => {
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(async (request) => ({
      ...request,
      expiresInMs: request.ttlMs,
      connectionGeneration: 1,
      reconnectProof: "proof-1",
      state: "active" as const,
      configHash: "config-1",
    }));
    const adapter = new XfsCashAcceptanceLeaseAdapter({
      commandLeases: {
        getHostEpoch: async () => "epoch-1",
        acquire,
        release,
      } as never,
      ownerInstanceId: "runtime-1",
      nextFencingToken: async () => 41,
    });

    const lease = await adapter.acquire({
      authority: "transaction",
      logicalService: "CIM30",
      operationId: "deposit-1",
      resourceGroup: "cash-transport-1",
    });
    await lease.release();
    await lease.release();

    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      hostEpoch: "epoch-1",
      fencingToken: 41,
      ownerInstanceId: "runtime-1",
      resourceGroup: "cash-transport-1",
    }));
    expect(release).toHaveBeenCalledOnce();
  });
});
