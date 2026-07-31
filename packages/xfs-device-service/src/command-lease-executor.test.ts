import { describe, expect, it, vi } from "vitest";

import { HostCommandLeaseExecutor } from "./command-lease-executor";
import type { XfsCommandLeaseClientLike } from "./types";

describe("HostCommandLeaseExecutor", () => {
  it("acquires, executes, and releases a host-backed command lease", async () => {
    const fixture = createFixture();
    const executor = new HostCommandLeaseExecutor(fixture.client, "owner-1");

    await expect(executor.run(execution("operation-1"), async () => "ok")).resolves.toBe("ok");

    expect(fixture.events.map(({ kind }) => kind)).toEqual([
      "acquireNext",
      "command",
      "release",
    ]);
    expect(fixture.events[0]).toMatchObject({
      authority: "transaction",
      fencingToken: 5_001,
      logicalService: "IDC",
      operationId: "operation-1",
      ownerInstanceId: "owner-1",
      protectionPolicyProfileId: "real-smoke",
      resourceGroup: "card-transport-1",
    });
  });

  it("serializes commands for the same logical service", async () => {
    const fixture = createFixture();
    const executor = new HostCommandLeaseExecutor(fixture.client, "owner-1");
    let active = 0;
    let maximumActive = 0;
    const command = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };

    await Promise.all([
      executor.run(execution("operation-1"), command),
      executor.run(execution("operation-2"), command),
    ]);

    expect(maximumActive).toBe(1);
    expect(fixture.events.filter(({ kind }) => kind === "acquireNext")).toHaveLength(2);
  });

  it("releases the lease when the command fails", async () => {
    const fixture = createFixture();
    const executor = new HostCommandLeaseExecutor(fixture.client, "owner-1");

    await expect(executor.run(execution("operation-1"), async () => {
      throw new Error("command failed");
    })).rejects.toThrow("command failed");

    expect(fixture.events.at(-1)?.kind).toBe("release");
  });

  it("borrows an active lease owned by the same runtime", async () => {
    const fixture = createFixture();
    fixture.currentLease = {
      authority: "recovery",
      connectionGeneration: 1,
      configHash: "config",
      expiresInMs: 30_000,
      fencingToken: 6_000,
      hostEpoch: "epoch-1",
      logicalService: "IDC",
      operationId: "card-return",
      ownerInstanceId: "owner-1",
      protectionPolicyProfileHash: "hash",
      protectionPolicyProfileId: "real-smoke",
      protectionPolicyProfileVersion: "1",
      reconnectProof: "proof",
      resourceGroup: "card-transport-1",
      state: "active",
    };
    const executor = new HostCommandLeaseExecutor(fixture.client, "owner-1");
    const command = vi.fn(async () => "ok");

    await expect(
      executor.run(execution("nested-command"), command),
    ).resolves.toBe("ok");

    expect(command).toHaveBeenCalledOnce();
    expect(fixture.events).toEqual([]);
  });

  it("runs without lease calls when command leasing is unavailable", async () => {
    const executor = new HostCommandLeaseExecutor(undefined, "owner-1");
    const command = vi.fn(async () => "ok");

    await expect(executor.run(execution("operation-1"), command)).resolves.toBe("ok");

    expect(command).toHaveBeenCalledOnce();
  });

  it("uses the current lease client after connect or reconnect", async () => {
    const first = createFixture();
    const second = createFixture();
    let current: XfsCommandLeaseClientLike | undefined;
    const executor = new HostCommandLeaseExecutor(() => current, "owner-1");

    current = first.client;
    await executor.run(execution("operation-1"), async () => "first");
    current = second.client;
    await executor.run(execution("operation-2"), async () => "second");

    expect(first.events.some(({ operationId }) => operationId === "operation-1")).toBe(true);
    expect(second.events.some(({ operationId }) => operationId === "operation-2")).toBe(true);
  });

  it("uses a host-allocated token after a previous runtime raised the high watermark", async () => {
    const fixture = createFixture(9_000_001);
    const executor = new HostCommandLeaseExecutor(fixture.client, "owner-after-reload");

    await executor.run(execution("operation-after-reload"), async () => "ok");

    expect(fixture.events[0]).toMatchObject({
      fencingToken: 9_000_001,
      kind: "acquireNext",
      operationId: "operation-after-reload",
    });
  });
});

const execution = (operationId: string) => ({
  authority: "transaction" as const,
  logicalService: "IDC",
  operationId,
  protectionPolicyProfileId: "real-smoke",
  resourceGroup: "card-transport-1",
  ttlMs: 30_000,
});

const createFixture = (nextFencingToken = 5_001) => {
  const events: Array<Record<string, unknown> & { kind: string }> = [];
  const fixture: {
    currentLease?: Awaited<ReturnType<XfsCommandLeaseClientLike["status"]>>;
  } = {};
  const client: XfsCommandLeaseClientLike = {
    acquire: async (request) => {
      events.push({ kind: "acquire", ...request });
      return {
        ...request,
        acquiredAtUnixMs: Date.now(),
        expiresAtUnixMs: Date.now() + request.ttlMs,
      } as unknown as Awaited<ReturnType<XfsCommandLeaseClientLike["acquire"]>>;
    },
    acquireNext: async (request) => {
      events.push({ fencingToken: nextFencingToken, kind: "acquireNext", ...request });
      return {
        ...request,
        fencingToken: nextFencingToken,
      } as unknown as Awaited<ReturnType<XfsCommandLeaseClientLike["acquireNext"]>>;
    },
    getHostEpoch: async () => "epoch-1",
    release: async (request) => {
      events.push({ kind: "release", ...request });
    },
    status: async () => fixture.currentLease ?? null,
    transition: async () => {
      throw new Error("not implemented");
    },
  };
  const originalAcquireNext = client.acquireNext;
  client.acquireNext = async (request) => {
    const lease = await originalAcquireNext(request);
    const originalRelease = client.release;
    client.release = async (release) => {
      events.push({ kind: "command" });
      client.release = originalRelease;
      await originalRelease(release);
    };
    return lease;
  };
  return Object.assign(fixture, { client, events });
};
