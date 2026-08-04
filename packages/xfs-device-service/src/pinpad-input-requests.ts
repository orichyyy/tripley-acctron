import {
  type XfsPinBlockRequest,
  XfsPinFormatFromRaw,
  XfsPinFunctionKeyFromRaw,
  type XfsPinGetDataRequest,
  type XfsPinGetPinRequest,
} from "@tripley-kit/xfs-client";

export const pinBlockRequest = (
  options: unknown,
  sessionId: string,
  timeoutMs: number,
): XfsPinBlockRequest => {
  const input = asRecord(options);
  return {
    ...(stringValue(input.customerData) ? { customerData: stringValue(input.customerData) } : {}),
    format: XfsPinFormatFromRaw(numberValue(input.format ?? input.pinBlockFormat, 2)),
    ...(stringValue(input.keyEncKeyName)
      ? { keyEncKeyName: stringValue(input.keyEncKeyName) }
      : {}),
    ...(stringValue(input.keyName ?? input.keySlot)
      ? { keyName: stringValue(input.keyName ?? input.keySlot) }
      : {}),
    padding: numberValue(input.padding, 0),
    sessionId,
    timeoutMs: numberValue(input.timeoutMs, timeoutMs),
    ...(stringValue(input.xorData) ? { xorData: stringValue(input.xorData) } : {}),
  };
};

export const pinEntryRequest = (
  options: unknown,
  sessionId: string,
  timeoutMs: number,
): XfsPinGetPinRequest => {
  const input = asRecord(options);
  return {
    activeFdks: numberValue(input.activeFdks, 0),
    activeKeys: XfsPinFunctionKeyFromRaw(numberValue(input.activeKeys, 0x03ff)),
    autoEnd: booleanValue(input.autoEnd, true),
    echo: numberValue(input.echo, 0),
    maxLen: numberValue(input.maxLength ?? input.maxLen, 12),
    minLen: numberValue(input.minLength ?? input.minLen, 4),
    sessionId,
    terminateFdks: numberValue(input.terminateFdks, 0),
    terminateKeys: XfsPinFunctionKeyFromRaw(numberValue(input.terminateKeys, 0x0400)),
    timeoutMs: numberValue(input.timeoutMs, timeoutMs),
  };
};

export const pinDataRequest = (
  options: unknown,
  sessionId: string,
  timeoutMs: number,
): XfsPinGetDataRequest => {
  const input = asRecord(options);
  return {
    activeFdks: numberValue(input.activeFdks, 0),
    activeKeys: XfsPinFunctionKeyFromRaw(numberValue(input.activeKeys, 0xffff)),
    autoEnd: booleanValue(input.autoEnd, true),
    maxLen: numberValue(input.maxLength ?? input.maxLen, 12),
    sessionId,
    terminateFdks: numberValue(input.terminateFdks, 0),
    terminateKeys: XfsPinFunctionKeyFromRaw(numberValue(input.terminateKeys, 0)),
    timeoutMs: numberValue(input.timeoutMs, timeoutMs),
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const numberValue = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
