export class XfsHostdUnavailableError extends Error {
  public constructor(url: string, cause: unknown) {
    super(
      `Cannot connect to Tripley Native Host at ${url}. Start hostd with xfs and xfs-control services, then rerun pnpm test:xfs-hostd.`,
      { cause },
    );
    this.name = "XfsHostdUnavailableError";
  }
}

export class XfsHostdCapabilityError extends Error {
  public constructor(url: string, cause: unknown) {
    super(
      `Tripley Native Host at ${url} is running without the required xfs-control capability. Restart hostd with --services runtime,xfs,xfs-control, then rerun pnpm test:xfs-hostd.`,
      { cause },
    );
    this.name = "XfsHostdCapabilityError";
  }
}

export const classifyHostdConnectionError = (url: string, cause: unknown): Error => {
  if (cause instanceof Error && cause.message.includes("XFS control service")) {
    return new XfsHostdCapabilityError(url, cause);
  }

  return new XfsHostdUnavailableError(url, cause);
};
