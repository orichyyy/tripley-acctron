import { FrameworkError } from "@tripley/web-container-errors";

import type { AuthenticationChallengeContribution, EntryMethodContribution } from "./types";

class VersionedContributionRegistry<T extends { readonly id: string; readonly version: string }> {
  private readonly contributions = new Map<string, T>();

  public constructor(private readonly kind: string) {}

  public register(contribution: T): void {
    if (this.contributions.has(contribution.id)) {
      throw new FrameworkError({
        category: "extension",
        code: `${this.kind}.duplicate`,
        message: `${this.kind} contribution is already registered: ${contribution.id}`,
        metadata: { contributionId: contribution.id, version: contribution.version },
      });
    }
    this.contributions.set(contribution.id, contribution);
  }

  public get(id: string): T | undefined {
    return this.contributions.get(id);
  }

  public require(id: string): T {
    const contribution = this.get(id);
    if (!contribution) {
      throw new FrameworkError({
        category: "extension",
        code: `${this.kind}.missing`,
        message: `${this.kind} contribution is not registered: ${id}`,
        metadata: { contributionId: id },
      });
    }
    return contribution;
  }

  public list(): readonly T[] {
    return [...this.contributions.values()];
  }
}

export class EntryMethodRegistry extends VersionedContributionRegistry<EntryMethodContribution> {
  public constructor() {
    super("entryMethod");
  }

  public override list(): readonly EntryMethodContribution[] {
    return [...super.list()].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }
}

export class AuthenticationChallengeRegistry extends VersionedContributionRegistry<AuthenticationChallengeContribution> {
  public constructor() {
    super("authenticationChallenge");
  }
}
