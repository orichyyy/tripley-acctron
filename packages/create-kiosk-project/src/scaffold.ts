import { resolve } from "node:path";

export const kioskProjectAgentFile = "AGENTS.md";

export interface KioskProjectScaffoldPlan {
  readonly rootDirectory: string;
  readonly files: readonly KioskProjectScaffoldFile[];
}

export interface KioskProjectScaffoldFile {
  readonly relativePath: string;
  readonly overwrite: boolean;
}

export interface PlanKioskProjectScaffoldOptions {
  readonly force?: boolean | undefined;
}

export function planKioskProjectScaffold(
  targetDirectory: string,
  options: PlanKioskProjectScaffoldOptions = {},
): KioskProjectScaffoldPlan {
  const normalizedTarget = targetDirectory.trim();
  if (!normalizedTarget) {
    throw new KioskProjectScaffoldError(
      "scaffold.target.required",
      "A kiosk project target directory is required.",
    );
  }

  return {
    files: [
      {
        overwrite: options.force ?? false,
        relativePath: kioskProjectAgentFile,
      },
    ],
    rootDirectory: resolve(normalizedTarget),
  };
}

export class KioskProjectScaffoldError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "KioskProjectScaffoldError";
  }
}
