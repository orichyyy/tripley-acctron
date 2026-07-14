import type {
  HostFieldDefinition,
  HostFieldSet,
  HostFieldValue,
  SafeHostMessageSummary,
  SafeSummaryPolicy,
  UnpackedHostMessage,
} from "./contracts";

const defaultPolicy = (field: HostFieldDefinition): SafeSummaryPolicy => {
  switch (field.dataClassification) {
    case "public": return { mode: "value" };
    case "internal": return { mode: "presence" };
    case "sensitive": return { mode: "masked", showLast: 4 };
    case "secret": return { mode: "presence" };
  }
};

const isRepeatingGroup = (value: HostFieldValue): value is readonly HostFieldSet[] =>
  Array.isArray(value);

const summarize = (value: HostFieldValue, policy: SafeSummaryPolicy): string | number | boolean | undefined => {
  if (isRepeatingGroup(value)) return value.length;
  switch (policy.mode) {
    case "omit":
      return undefined;
    case "presence":
      return value.length > 0;
    case "value":
      return value instanceof Uint8Array ? value.length : value;
    case "masked": {
      if (value instanceof Uint8Array) return value.length;
      const first = Math.max(0, policy.showFirst ?? 0);
      const last = Math.max(0, policy.showLast ?? 0);
      const visible = Math.min(value.length, first + last);
      return `${value.slice(0, first)}${"*".repeat(value.length - visible)}${last === 0 ? "" : value.slice(-last)}`;
    }
  }
};

export const createSafeSummary = (
  message: UnpackedHostMessage,
  fieldsById: ReadonlyMap<string, HostFieldDefinition>,
): SafeHostMessageSummary => {
  const fields: Record<string, string | number | boolean> = {};
  for (const [fieldId, value] of Object.entries(message.fields)) {
    if (isRepeatingGroup(value)) {
      fields[`${fieldId}.count`] = value.length;
      continue;
    }
    const definition = fieldsById.get(fieldId);
    if (!definition) continue;
    const summary = summarize(value, definition.safeSummary ?? defaultPolicy(definition));
    if (summary !== undefined) fields[fieldId] = summary;
  }
  return { fields, reference: message.reference, wireLength: message.wireLength };
};
