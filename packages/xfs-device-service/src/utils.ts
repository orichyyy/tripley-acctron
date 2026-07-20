import { FrameworkError } from "@tripley-kit/web-container-errors";

export const defaultXfsTimeoutMs = 30_000;
export const defaultXfsAppId = "tripley-web-container";
export const defaultXfsVersionRange = { high: 0x2803, low: 0x0203 } as const;

export const hResultOf = (result: unknown): number => {
  if (!result || typeof result !== "object") {
    return 0;
  }

  const record = result as Record<string, unknown>;
  if (typeof record.hResult === "number") {
    return record.hResult;
  }

  if (typeof record.hresult === "number") {
    return record.hresult;
  }

  if (record.native) {
    return hResultOf(record.native);
  }

  return 0;
};

export const assertXfsOk = (
  result: unknown,
  action: string,
  metadata: Record<string, unknown> = {},
): void => {
  const hResult = hResultOf(result);
  if (hResult === 0) {
    return;
  }

  throw new FrameworkError({
    category: "native",
    code: "xfs.command.failed",
    message: `XFS command failed during ${action}: ${formatHResult(hResult)}`,
    metadata: { ...metadata, hResult },
  });
};

export const formatHResult = (hResult: number): string => `0x${Number(hResult >>> 0).toString(16)}`;

export const bytesToHex = (value: unknown): string | undefined => {
  if (value instanceof Uint8Array) {
    return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  if (value instanceof ArrayBuffer) {
    return bytesToHex(new Uint8Array(value));
  }

  return undefined;
};

export const bytesToText = (value: unknown): string | undefined => {
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }

  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(value));
  }

  return typeof value === "string" ? value : undefined;
};

export const plainValueFromKeys = (keys: unknown): string | undefined => {
  if (!Array.isArray(keys)) {
    return undefined;
  }

  const value = keys
    .map((key) => {
      if (!key || typeof key !== "object") {
        return "";
      }

      const record = key as Record<string, unknown>;
      const explicitValue = record.charValue ?? record.value ?? record.key;
      if (explicitValue !== undefined) {
        return explicitValue;
      }

      return xfsFunctionKeyToDigit(record.digit);
    })
    .join("");

  return value.length > 0 ? value : undefined;
};

const xfsFunctionKeyToDigit = (value: unknown): string => {
  if (typeof value !== "number" || value < 1 || value > 0x0200) {
    return "";
  }

  const index = Math.log2(value);
  return Number.isInteger(index) && index <= 9 ? String(index) : "";
};
