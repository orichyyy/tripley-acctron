import { describe, expect, it, vi } from "vitest";

import { HostCommandLeaseExecutor } from "./command-lease-executor";
import type { XfsCommandLeaseClientLike } from "./types";

describe("HostCommandLeaseExecutor", () => {
  it("acquires, executes, and releases a host-backed command lease", async () => {
    const fixture = createFixture();
    const executor = new HostCommandLeaseExecutor(fixture.client, "owner-1");

    await expect(executor.run(execution("operation-1"), async () => "ok")).resolves.toBe("ok");

    expect(fixture.events.map(({ kind }) => kind)).toEqual([
      "status",
      "acquire",
      "command",
      "release",
    ]);
    expect(fixture.events[1]).toMatchObject({
      authority: "transaction",
      logicalService: "IDC",
      operationId: "operation-1",
      ownerInstanceId: "owner-1",
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
    expect(fixture.events.filter(({ kind }) => kind === "acquire")).toHaveLength(2);
  });

  it("releases the lease when the command fails", async () => {
    const fixture = createFixture();
    const executor = new HostCommandLeaseExecutor(fixture.client, "owner-1");

    await expect(executor.run(execution("operation-1"), async () => {
      throw new Error("command failed");
    })).rejects.toThrow("command failed");

    expect(fixture.events.at(-1)?.kind).toBe("release");
  });

  it("runs without lease calls when command leasing is unavailable", async () => {
    const executor = new HostCommandLeaseExecutor(undefined, "owner-1");
    const command = vi.fn(async () => "ok");

    await expect(executor.run(execution("operation-1"), command)).resolves.toBe("ok");

    expect(command).toHaveBeenCalledOnce();
  });
});

const execution = (operationId: string) => ({
  authority: "transaction" as const,
  logicalService: "IDC",
  operationId,
  resourceGroup: "card-transport-1",
  ttlMs: 30_000,
});

const createFixture = () => {
  const events: Array<Record<string, unknown> & { kind: string }> = [];
  const client: XfsCommandLeaseClientLike = {
    acquire: async (request) => {
      events.push({ kind: "acquire", ...request });
      return {
        ...request,
        acquiredAtUnixMs: Date.now(),
        expiresAtUnixMs: Date.now() + request.ttlMs,
      } as unknown as Awaited<ReturnType<XfsCommandLeaseClientLike["acquire"]>>;
    },
    getHostEpoch: async () => "epoch-1",
    release: async (request) => {
      events.push({ kind: "release", ...request });
    },
    status: async (logicalService) => {
      events.push({ kind: "status", logicalService });
      return null;
    },
    transition: async () => {
      throw new Error("not implemented");
    },
  };
  const originalAcquire = client.acquire;
  client.acquire = async (request) => {
    const lease = await originalAcquire(request);
    const originalRelease = client.release;
    client.release = async (release) => {
      events.push({ kind: "command" });
      client.release = originalRelease;
      await originalRelease(release);
    };
    return lease;
  };
  return { client, events };
};
