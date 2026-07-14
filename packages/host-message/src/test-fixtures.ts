import type { FieldCodec, HostMessageProfile } from "./contracts";
import { hostMessageFailure } from "./failures";

export const fixedProfile: HostMessageProfile = {
  id: "fixture.fixed",
  version: "1",
  codecId: "fixed-field",
  maxMessageBytes: 128,
  fieldDefinitions: [
    { id: "messageType", dataClassification: "public", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 1 } },
    { id: "trace", dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 6 } },
    { id: "amount", dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 12 } },
    { id: "accountCount", dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 2 }, padding: { byte: 0x30, direction: "left" } },
    { id: "account", dataClassification: "sensitive", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 4 }, safeSummary: { mode: "masked", showLast: 2 } },
    { id: "balance", dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 4 } },
    { id: "pinBlock", dataClassification: "secret", encoding: { kind: "binary" }, length: { kind: "fixed", bytes: 8 } },
  ],
  messages: [
    {
      id: "authorization.request",
      direction: "request",
      fields: [
        { kind: "field", fieldId: "messageType", presence: "required" },
        { kind: "field", fieldId: "trace", presence: "required" },
        { kind: "field", fieldId: "amount", presence: "required" },
        { kind: "repeatingGroup", id: "accounts", countFieldId: "accountCount", itemFieldIds: ["account", "balance"], maxItems: 2, fixedAreaBytes: 16, padByte: 0x20 },
      ],
    },
    {
      id: "secure.request",
      direction: "request",
      fields: [
        { kind: "field", fieldId: "messageType", presence: "required" },
        { kind: "field", fieldId: "account", presence: "required" },
        { kind: "field", fieldId: "pinBlock", presence: "required" },
      ],
    },
  ],
};

export const isoProfile: HostMessageProfile = {
  id: "fixture.iso1987",
  version: "1",
  codecId: "iso8583",
  maxMessageBytes: 512,
  fieldDefinitions: [
    { id: "pan", dataElement: 2, dataClassification: "sensitive", encoding: { kind: "ascii" }, length: { kind: "llvar", maxLength: 19, lengthEncoding: "ascii" }, safeSummary: { mode: "masked", showFirst: 6, showLast: 4 } },
    { id: "processingCode", dataElement: 3, dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 6 } },
    { id: "amount", dataElement: 4, dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 12 } },
    { id: "stan", dataElement: 11, dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 6 } },
    { id: "privateData", dataElement: 48, dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "lllvar", maxLength: 999, lengthEncoding: "bcd" } },
    { id: "responseCode", dataElement: 39, dataClassification: "public", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 2 } },
    { id: "networkCode", dataElement: 70, dataClassification: "internal", encoding: { kind: "ascii" }, length: { kind: "fixed", bytes: 3 } },
  ],
  messages: [
    {
      id: "authorization.request",
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
    {
      id: "network.request",
      direction: "request",
      mti: "0800",
      mtiEncoding: "bcd",
      bitmapEncoding: "ascii-hex",
      fields: [
        { kind: "field", fieldId: "privateData", presence: "required" },
        { kind: "field", fieldId: "networkCode", presence: "required" },
      ],
    },
  ],
};

export const reverseAsciiCodec: FieldCodec = {
  id: "fixture.reverse-ascii",
  version: "1",
  encode(value, context) {
    if (typeof value !== "string") {
      return { ok: false, error: hostMessageFailure("hostMessage.field.codecFailed", "Reverse codec requires a string", { fieldId: context.field.id }) };
    }
    const reversed = [...value].reverse().join("");
    return { ok: true, value: { bytes: new TextEncoder().encode(reversed), logicalLength: value.length } };
  },
  decode(bytes) {
    return { ok: true, value: [...new TextDecoder().decode(bytes)].reverse().join("") };
  },
};
