import type { HostMessageProfile } from "@tripley-kit/web-container-host-message";

const field = (
  id: string,
  bytes: number,
  dataClassification: "public" | "internal" | "sensitive" | "secret" = "internal",
) => ({
  dataClassification,
  encoding: { kind: "ascii" as const },
  id,
  length: { bytes, kind: "fixed" as const },
});

export const fixedExchangeProfile: HostMessageProfile = {
  codecId: "fixed-field",
  fieldDefinitions: [
    field("messageType", 2, "public"),
    field("pan", 16, "sensitive"),
    field("pinBlock", 8, "secret"),
    field("responseCode", 2, "public"),
    field("authorizationReference", 6, "internal"),
  ],
  id: "target51.fixed",
  maxMessageBytes: 64,
  messages: [
    {
      direction: "request",
      fields: [
        { fieldId: "messageType", kind: "field", presence: "required" },
        { fieldId: "pan", kind: "field", presence: "required" },
        { fieldId: "pinBlock", kind: "field", presence: "required" },
      ],
      id: "authorization.request",
    },
    {
      direction: "response",
      fields: [
        { fieldId: "responseCode", kind: "field", presence: "required" },
        { fieldId: "authorizationReference", kind: "field", presence: "required" },
      ],
      id: "authorization.response",
    },
  ],
  version: "1",
};

export const isoExchangeProfile: HostMessageProfile = {
  codecId: "iso8583",
  fieldDefinitions: [
    { ...field("stan", 6), dataElement: 11 },
    { ...field("authorizationReference", 6), dataElement: 38 },
    { ...field("responseCode", 2, "public"), dataElement: 39 },
  ],
  id: "target51.iso",
  maxMessageBytes: 128,
  messages: [
    {
      direction: "request",
      fields: [{ fieldId: "stan", kind: "field", presence: "required" }],
      id: "authorization.request",
      mti: "0200",
    },
    {
      direction: "response",
      fields: [
        { fieldId: "authorizationReference", kind: "field", presence: "required" },
        { fieldId: "responseCode", kind: "field", presence: "required" },
      ],
      id: "authorization.response",
      mti: "0210",
    },
  ],
  version: "1",
};
