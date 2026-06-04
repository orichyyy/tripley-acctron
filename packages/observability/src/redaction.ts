import type { RedactionKind, RedactionService } from "@tripley-acctron/contracts";

const SECRET_KEYS = new Set(["pin", "password", "secret"]);
const PARTIAL_KEYS = new Set(["account", "accountNo", "card", "cardNo", "idNo"]);

export function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, redactValue(key, value)]),
  );
}

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEYS.has(key)) {
    return "[redacted]";
  }
  if (PARTIAL_KEYS.has(key) && typeof value === "string") {
    return mask(value);
  }
  return value;
}

export class DefaultRedactionService implements RedactionService {
  public redact(_eventName: string, payload: unknown, redactAs?: RedactionKind): unknown {
    if (redactAs) {
      return this.redactValue(redactAs, payload);
    }
    return redactPayload(payload);
  }

  public redactValue(redactAs: RedactionKind, value: unknown): unknown {
    if (redactAs === "pin" || redactAs === "password") {
      return "[redacted]";
    }
    if (
      redactAs === "account" ||
      redactAs === "accountNo" ||
      redactAs === "idNo" ||
      redactAs === "customerInput"
    ) {
      return typeof value === "string" ? mask(value) : "[redacted]";
    }
    if (redactAs === "card" || redactAs === "cardNo") {
      return typeof value === "string" ? this.cardNo(value) : "[redacted]";
    }
    return typeof value === "string" ? this.barcode(value) : "[redacted]";
  }

  public pinpadKey(key: string, redactAs?: RedactionKind): string {
    if (redactAs === "pin" || redactAs === "password") {
      return "[redacted]";
    }
    return key;
  }

  public accountNo(value: string): string {
    return mask(value);
  }

  public cardNo(value: string): string {
    return mask(value);
  }

  public barcode(value: string): string {
    return mask(value);
  }
}

function redactPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map(redactPayload);
  }
  if (typeof payload !== "object" || payload === null) {
    return payload;
  }
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === "object" && value !== null ? redactPayload(value) : redactValue(key, value),
    ]),
  );
}

function mask(value: string): string {
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 2)}${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}
