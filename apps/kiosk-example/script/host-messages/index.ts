import type { FieldCodec, HostMessageProfile } from "@tripley-kit/web-container-host-message";

export const kioskHostProfiles: readonly HostMessageProfile[] = [
  {
    id: "kiosk-example.fixed-host",
    version: "1",
    codecId: "fixed-field",
    maxMessageBytes: 1024,
    fieldDefinitions: [
      { id: "messageType", dataClassification: "public", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 2 } },
      { id: "traceNumber", dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 6 } },
      { id: "pan", dataClassification: "sensitive", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 19 }, padding: { byte: 0x20, direction: "right", stripOnDecode: true }, safeSummary: { mode: "masked", showFirst: 6, showLast: 4 } },
      { id: "amount", dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 12 } },
      { id: "pinBlock", dataClassification: "secret", encoding: { kind: "binary" }, length: { kind: "fixed", bytes: 8 }, safeSummary: { mode: "presence" } },
    ],
    messages: [
      {
        id: "withdrawal.authorization.request",
        direction: "request",
        fields: [
          { kind: "field", fieldId: "messageType", presence: "required" },
          { kind: "field", fieldId: "traceNumber", presence: "required" },
          { kind: "field", fieldId: "pan", presence: "required" },
          { kind: "field", fieldId: "amount", presence: "required" },
          { kind: "field", fieldId: "pinBlock", presence: "required" },
        ],
      },
    ],
  },
  {
    id: "kiosk-example.iso8583",
    version: "1987.1",
    codecId: "iso8583",
    maxMessageBytes: 2048,
    fieldDefinitions: [
      { id: "pan", dataElement: 2, dataClassification: "sensitive", encoding: { kind: "ascii" }, length: { kind: "llvar", maxLength: 19, lengthEncoding: "ascii" }, safeSummary: { mode: "masked", showFirst: 6, showLast: 4 } },
      { id: "processingCode", dataElement: 3, dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 6 } },
      { id: "amount", dataElement: 4, dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 12 } },
      { id: "stan", dataElement: 11, dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 6 } },
    ],
    messages: [
      {
        id: "withdrawal.authorization.request",
        direction: "request",
        mti: "0200",
        mtiEncoding: "ascii",
        bitmapEncoding: "binary",
        fields: [
          { kind: "field", fieldId: "pan", presence: "required" },
          { kind: "field", fieldId: "processingCode", presence: "required" },
          { kind: "field", fieldId: "amount", presence: "required" },
          { kind: "field", fieldId: "stan", presence: "required" },
        ],
      },
    ],
  },
];

export const kioskLegacyFieldCodecFixture: FieldCodec = {
  id: "kiosk-example.legacy-xor",
  version: "1",
  encode(value, context) {
    if (!(value instanceof Uint8Array)) {
      return {
        ok: false,
        error: {
          category: "protocol",
          code: "hostMessage.field.codecFailed",
          message: "Legacy codec requires bytes",
          fieldId: context.field.id,
        },
      };
    }
    return { ok: true, value: { bytes: value.map((byte) => byte ^ 0x30), logicalLength: value.length } };
  },
  decode(bytes) {
    return { ok: true, value: bytes.map((byte) => byte ^ 0x30) };
  },
};
