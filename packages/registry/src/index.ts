import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { Metadata } from "@tripley-kit/web-container-types";

export type RegistryKey<TNamespace extends string = string> = string & {
  readonly __registryNamespace?: TNamespace;
};

export interface RegistryEntry<TValue> {
  readonly metadata?: Metadata | undefined;
  readonly value: TValue;
}

export interface RegistrySnapshot<TValue> {
  readonly key: string;
  readonly metadata?: Metadata | undefined;
  readonly value: TValue;
}

export class ExtensionRegistry<TValue, TKey extends string = string> {
  private readonly entries = new Map<TKey, RegistryEntry<TValue>>();

  public constructor(private readonly registryName: string) {}

  public register(key: TKey, value: TValue, metadata?: Metadata): void {
    if (this.entries.has(key)) {
      throw new FrameworkError({
        category: "extension",
        code: "registry.duplicateKey",
        message: `${this.registryName} already contains key: ${key}`,
        metadata: { key, registryName: this.registryName },
      });
    }

    this.entries.set(key, { metadata, value });
  }

  public get(key: TKey): TValue | undefined {
    return this.entries.get(key)?.value;
  }

  public require(key: TKey): TValue {
    const value = this.get(key);
    if (value === undefined) {
      throw new FrameworkError({
        category: "dependency",
        code: "registry.missingKey",
        message: `${this.registryName} is missing required key: ${key}`,
        metadata: { key, registryName: this.registryName },
      });
    }

    return value;
  }

  public has(key: TKey): boolean {
    return this.entries.has(key);
  }

  public list(): RegistrySnapshot<TValue>[] {
    return [...this.entries.entries()].map(([key, entry]) => ({
      key,
      metadata: entry.metadata,
      value: entry.value,
    }));
  }
}

export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  public register<TService>(key: string, service: TService): void {
    if (this.services.has(key)) {
      throw new FrameworkError({
        category: "dependency",
        code: "serviceRegistry.duplicateKey",
        message: `Service already registered: ${key}`,
        metadata: { key },
      });
    }

    this.services.set(key, service);
  }

  public get<TService>(key: string): TService | undefined {
    return this.services.get(key) as TService | undefined;
  }

  public require<TService>(key: string): TService {
    const service = this.get<TService>(key);
    if (service === undefined) {
      throw new FrameworkError({
        category: "dependency",
        code: "serviceRegistry.missingKey",
        message: `Required service is missing: ${key}`,
        metadata: { key },
      });
    }

    return service;
  }
}
