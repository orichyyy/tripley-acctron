import type { JsonValue, Metadata } from "@tripley-kit/web-container-types";

export const jsonText = (value: JsonValue | Metadata | undefined): string | null =>
  value === undefined ? null : JSON.stringify(value);

export const parseJson = <T>(value: string | null): T | undefined =>
  value === null ? undefined : JSON.parse(value) as T;

export const optional = <T>(key: string, value: T | null): Record<string, T> =>
  value === null ? {} : { [key]: value };

