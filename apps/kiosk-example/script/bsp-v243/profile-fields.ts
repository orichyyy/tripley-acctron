import type { HostFieldDefinition } from "@tripley-kit/web-container-host-message";

interface BspFieldOptions {
  readonly classification?: HostFieldDefinition["dataClassification"];
  readonly numeric?: boolean;
  readonly summary?: HostFieldDefinition["safeSummary"];
}

export const bspField = (
  id: string,
  bytes: number,
  options: BspFieldOptions = {},
): HostFieldDefinition => ({
  allowBlank: true,
  dataClassification: options.classification ?? "internal",
  encoding: { kind: "ascii" },
  id,
  length: { bytes, kind: "fixed" },
  padding: {
    byte: options.numeric ? 0x30 : 0x20,
    direction: options.numeric ? "left" : "right",
    stripOnDecode: !options.numeric,
  },
  safeSummary: options.summary ?? { mode: "omit" },
  ...(options.numeric ? { validation: { pattern: "^\\d*$" } } : {}),
});

export const uses = (...fieldIds: readonly string[]) =>
  fieldIds.map((fieldId) => ({ fieldId, kind: "field" as const }));
