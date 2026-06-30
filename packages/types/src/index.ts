export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type MaybePromise<T> = T | Promise<T>;

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type Metadata = Readonly<Record<string, JsonValue>>;

export type StringKey<TName extends string> = Brand<string, TName>;

export interface ResultOk<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

export interface ResultErr<TError> {
  readonly ok: false;
  readonly error: TError;
}

export type Result<TValue, TError> = ResultOk<TValue> | ResultErr<TError>;

export const ok = <TValue>(value: TValue): ResultOk<TValue> => ({ ok: true, value });

export const err = <TError>(error: TError): ResultErr<TError> => ({ error, ok: false });
