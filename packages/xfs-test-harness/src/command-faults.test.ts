import { describe, expect, it, vi } from "vitest";

import { withXfsCommandFailure } from "./command-faults";

describe("XFS simulator command faults", () => {
  it("restores automatic command handling after a failed scenario", async () => {
    const clearSpExecuteReturnPolicy = vi.fn(async () => undefined);
    const getSpExecuteReturnPolicy = vi.fn(async () => ({}));
    const setSpExecuteReturnPolicy = vi.fn(async () => undefined);

    await expect(withXfsCommandFailure(
      {
        clearSpExecuteReturnPolicy,
        getSpExecuteReturnPolicy,
        setSpExecuteReturnPolicy,
      },
      {
        command: 302,
        hresult: -316,
        logicalName: "CashDispenser1",
      },
      async () => {
        throw new Error("scenario failed");
      },
    )).rejects.toThrow("scenario failed");

    expect(setSpExecuteReturnPolicy).toHaveBeenCalledOnce();
    expect(setSpExecuteReturnPolicy).toHaveBeenCalledWith({
      policy: expect.objectContaining({
        command: 302,
        hresult: -316,
        scope: 0,
      }),
    });
    expect(clearSpExecuteReturnPolicy).toHaveBeenCalledWith({
      command: 302,
      logicalName: "CashDispenser1",
    });
  });

  it("restores a policy that existed before the scenario", async () => {
    const previous = {
      command: 302,
      hresult: -321,
      logicalName: "CashDispenser1",
      scope: 1 as const,
    };
    const setSpExecuteReturnPolicy = vi.fn(async () => undefined);
    const clearSpExecuteReturnPolicy = vi.fn(async () => undefined);

    await withXfsCommandFailure({
      clearSpExecuteReturnPolicy,
      getSpExecuteReturnPolicy: async () => ({ policy: previous }),
      setSpExecuteReturnPolicy,
    }, {
      command: 302,
      hresult: -316,
      logicalName: "CashDispenser1",
    }, async () => undefined);

    expect(setSpExecuteReturnPolicy).toHaveBeenLastCalledWith({
      policy: previous,
    });
    expect(clearSpExecuteReturnPolicy).not.toHaveBeenCalled();
  });
});
