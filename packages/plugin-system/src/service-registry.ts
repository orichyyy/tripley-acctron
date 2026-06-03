import {
  KioskError,
  type ProvideOptions,
  type ServiceRegistry,
  type ServiceToken,
} from "@tripley-acctron/contracts";

export function createServiceToken<T>(id: string, description?: string): ServiceToken<T> {
  return description ? { id, description } : { id };
}

export class DefaultServiceRegistry implements ServiceRegistry {
  private readonly values = new Map<string, unknown>();

  public provide<T>(token: ServiceToken<T>, value: T, options: ProvideOptions = {}): void {
    if (this.values.has(token.id) && !options.override && !options.multi) {
      throw new KioskError("service.duplicate", `Service ${token.id} has already been provided.`);
    }

    if (options.multi) {
      const current = this.values.get(token.id);
      const values = Array.isArray(current) ? current : [];
      this.values.set(token.id, [...values, value]);
      return;
    }

    this.values.set(token.id, value);
  }

  public get<T>(token: ServiceToken<T>): T {
    const value = this.tryGet(token);
    if (value === undefined) {
      throw new KioskError("service.notFound", `Service ${token.id} was not found.`);
    }
    return value;
  }

  public tryGet<T>(token: ServiceToken<T>): T | undefined {
    return this.values.get(token.id) as T | undefined;
  }

  public has<T>(token: ServiceToken<T>): boolean {
    return this.values.has(token.id);
  }
}
