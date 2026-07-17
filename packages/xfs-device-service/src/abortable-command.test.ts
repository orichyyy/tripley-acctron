import { describe, expect, it, vi } from "vitest";

import { runAbortableXfsCommand } from "./abortable-command";

describe("runAbortableXfsCommand", () => {
  it("cancels a pending native command before rejecting on abort", async () => {
    const abort = new AbortController();
    const cancel = vi.fn(async () => {});
    const pending = new Promise<never>(() => {});
    const result = runAbortableXfsCommand({
      cancel,
      execute: () => pending,
      signal: abort.signal,
    });

    abort.abort("capability.device.idc.unavailable");

    await expect(result).rejects.toMatchObject({
      message: "capability.device.idc.unavailable",
      name: "AbortError",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not start a command when its signal is already aborted", async () => {
    const abort = new AbortController();
    const execute = vi.fn(async () => "unexpected");
    abort.abort("route.exit");

    await expect(runAbortableXfsCommand({
      cancel: async () => {},
      execute,
      signal: abort.signal,
    })).rejects.toThrow("route.exit");
    expect(execute).not.toHaveBeenCalled();
  });
});
