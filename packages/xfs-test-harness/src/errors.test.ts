import { describe, expect, it } from "vitest";

import {
  XfsHostdCapabilityError,
  XfsHostdUnavailableError,
  classifyHostdConnectionError,
} from "./errors";

describe("hostd test diagnostics", () => {
  const url = "ws://127.0.0.1:39010";

  it("tells the operator how to start an unavailable hostd", () => {
    const error = classifyHostdConnectionError(url, new Error("ECONNREFUSED"));

    expect(error).toBeInstanceOf(XfsHostdUnavailableError);
    expect(error.message).toContain("Start hostd with xfs and xfs-control services");
    expect(error.message).toContain("pnpm test:xfs-hostd");
  });

  it("distinguishes a running hostd that omitted xfs-control", () => {
    const error = classifyHostdConnectionError(
      url,
      new Error("Tripley XFS control service 'RuntimeControl' was not resolved."),
    );

    expect(error).toBeInstanceOf(XfsHostdCapabilityError);
    expect(error.message).toContain("--services runtime,xfs,xfs-control");
  });
});
