import type { Metadata } from "@tripley-kit/web-container-types";

export interface FeatureFlagRecord {
  readonly id: string;
  readonly enabled: boolean;
  readonly metadata?: Metadata | undefined;
}

export class FeatureFlagService {
  private readonly flags = new Map<string, FeatureFlagRecord>();

  public constructor(flags: readonly FeatureFlagRecord[] = []) {
    for (const flag of flags) {
      this.flags.set(flag.id, flag);
    }
  }

  public isEnabled(id: string): boolean {
    return this.flags.get(id)?.enabled ?? false;
  }

  public set(id: string, enabled: boolean, metadata?: Metadata): void {
    this.flags.set(id, { id, enabled, metadata });
  }

  public list(): FeatureFlagRecord[] {
    return [...this.flags.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}
