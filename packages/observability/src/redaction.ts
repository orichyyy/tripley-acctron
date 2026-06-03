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

function mask(value: string): string {
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 2)}${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}
