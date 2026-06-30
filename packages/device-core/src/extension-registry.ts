import { FrameworkError } from "@tripley/web-container-errors";

export type OpenExtensionKind = string & {};

export type DuplicatePolicy = "reject" | "replace" | "ignore" | "chain";

export interface ExtensionRegistration<TValue> {
  readonly id: OpenExtensionKind;
  readonly version?: string | undefined;
  readonly ownerPluginId?: string | undefined;
  readonly priority?: number | undefined;
  readonly duplicatePolicy?: DuplicatePolicy | undefined;
  readonly value: TValue;
  dispose?(): void | Promise<void>;
}

export interface ExtensionRegistrationSnapshot<TValue> extends ExtensionRegistration<TValue> {
  readonly priority: number;
}

export class GenericExtensionRegistry<TValue> {
  private readonly registrations = new Map<string, ExtensionRegistrationSnapshot<TValue>[]>();

  public constructor(public readonly name: string) {}

  public register(registration: ExtensionRegistration<TValue>): void {
    const normalized = normalizeRegistration(registration);
    const existing = this.registrations.get(normalized.id) ?? [];
    const duplicatePolicy = normalized.duplicatePolicy ?? "reject";

    if (existing.length > 0) {
      if (duplicatePolicy === "reject") {
        throw new FrameworkError({
          category: "extension",
          code: "extension.duplicate",
          message: `${this.name} already contains extension: ${normalized.id}`,
          metadata: { extensionId: normalized.id, registryName: this.name },
        });
      }

      if (duplicatePolicy === "ignore") {
        return;
      }

      if (duplicatePolicy === "replace") {
        this.registrations.set(normalized.id, [normalized]);
        return;
      }
    }

    this.registrations.set(
      normalized.id,
      [...existing, normalized].sort((left, right) => right.priority - left.priority),
    );
  }

  public get(id: OpenExtensionKind): TValue | undefined {
    return this.registrations.get(id)?.[0]?.value;
  }

  public require(id: OpenExtensionKind): TValue {
    const value = this.get(id);
    if (value === undefined) {
      throw new FrameworkError({
        category: "extension",
        code: "extension.missing",
        message: `${this.name} is missing extension: ${id}`,
        metadata: { extensionId: id, registryName: this.name },
      });
    }

    return value;
  }

  public has(id: OpenExtensionKind): boolean {
    return this.registrations.has(id);
  }

  public list(): readonly ExtensionRegistrationSnapshot<TValue>[] {
    return [...this.registrations.values()].flat();
  }

  public listByOwner(ownerPluginId: string): readonly ExtensionRegistrationSnapshot<TValue>[] {
    return this.list().filter((registration) => registration.ownerPluginId === ownerPluginId);
  }

  public async disposeOwner(ownerPluginId: string): Promise<void> {
    for (const [id, registrations] of this.registrations) {
      const kept: ExtensionRegistrationSnapshot<TValue>[] = [];
      for (const registration of registrations) {
        if (registration.ownerPluginId !== ownerPluginId) {
          kept.push(registration);
          continue;
        }

        await registration.dispose?.();
      }

      if (kept.length === 0) {
        this.registrations.delete(id);
      } else {
        this.registrations.set(id, kept);
      }
    }
  }
}

const normalizeRegistration = <TValue>(
  registration: ExtensionRegistration<TValue>,
): ExtensionRegistrationSnapshot<TValue> => ({
  ...registration,
  priority: registration.priority ?? 0,
});
