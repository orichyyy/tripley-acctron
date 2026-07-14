import { err, ok, type Result } from "@tripley/web-container-types";
import { bytesToHex, hexToBytes } from "./bytes";
import type {
  EncodedFieldValue,
  FieldCodecContext,
  FieldCodecLookup,
  HostFieldDefinition,
  HostFieldValue,
  HostMessageFailure,
} from "./contracts";
import { hostMessageFailure } from "./failures";

type FieldResult<T> = Result<T, HostMessageFailure>;

const fieldFailure = (field: HostFieldDefinition, code: string, message: string): HostMessageFailure =>
  hostMessageFailure(code, message, {
    ...(field.dataElement === undefined ? {} : { dataElement: field.dataElement }),
    fieldId: field.id,
    phase: "fieldDecode",
  });

const encodeAscii = (value: string, field: HostFieldDefinition): FieldResult<EncodedFieldValue> => {
  if ([...value].some((character) => character.charCodeAt(0) > 0x7f)) {
    return err(fieldFailure(field, "hostMessage.field.decodeFailed", "ASCII field is invalid"));
  }
  return ok({ bytes: Uint8Array.from([...value].map((character) => character.charCodeAt(0))), logicalLength: value.length });
};

const encodeBcd = (value: string, field: HostFieldDefinition): FieldResult<EncodedFieldValue> => {
  if (!/^\d*$/.test(value)) {
    return err(fieldFailure(field, "hostMessage.field.decodeFailed", "BCD field is invalid"));
  }
  const encoding = field.encoding.kind === "bcd" ? field.encoding : undefined;
  if (encoding?.digitCount !== undefined && value.length !== encoding.digitCount) {
    return err(fieldFailure(field, "hostMessage.field.validationFailed", "BCD digit count is invalid"));
  }
  const pad = (encoding?.padNibble ?? 0).toString(16);
  const padded = value.length % 2 === 0
    ? value
    : encoding?.padDirection === "right"
      ? `${value}${pad}`
      : `${pad}${value}`;
  const bytes = hexToBytes(padded);
  return bytes
    ? ok({ bytes, logicalLength: value.length })
    : err(fieldFailure(field, "hostMessage.field.decodeFailed", "BCD field is invalid"));
};

const decodeBcd = (
  bytes: Uint8Array,
  field: HostFieldDefinition,
  logicalLength?: number,
): FieldResult<string> => {
  const encoding = field.encoding.kind === "bcd" ? field.encoding : undefined;
  const length = logicalLength ?? encoding?.digitCount ?? bytes.length * 2;
  let digits = bytesToHex(bytes);
  if (length % 2 !== 0) {
    digits = encoding?.padDirection === "right" ? digits.slice(0, length) : digits.slice(-length);
  }
  return /^\d*$/.test(digits)
    ? ok(digits)
    : err(fieldFailure(field, "hostMessage.field.decodeFailed", "BCD field is invalid"));
};

export const encodeFieldValue = (
  field: HostFieldDefinition,
  value: HostFieldValue,
  fieldCodecs: FieldCodecLookup,
): FieldResult<EncodedFieldValue> => {
  if (Array.isArray(value)) {
    return err(fieldFailure(field, "hostMessage.field.validationFailed", "Scalar field value is invalid"));
  }
  switch (field.encoding.kind) {
    case "ascii":
      return typeof value === "string"
        ? encodeAscii(value, field)
        : err(fieldFailure(field, "hostMessage.field.validationFailed", "ASCII field requires a string"));
    case "utf8": {
      if (typeof value !== "string") {
        return err(fieldFailure(field, "hostMessage.field.validationFailed", "UTF-8 field requires a string"));
      }
      return ok({ bytes: new TextEncoder().encode(value), logicalLength: value.length });
    }
    case "binary":
      return value instanceof Uint8Array
        ? ok({ bytes: value.slice(), logicalLength: value.length })
        : err(fieldFailure(field, "hostMessage.field.validationFailed", "Binary field requires bytes"));
    case "ascii-hex": {
      if (typeof value !== "string") {
        return err(fieldFailure(field, "hostMessage.field.validationFailed", "Hex field requires a string"));
      }
      const bytes = hexToBytes(value);
      return bytes
        ? ok({ bytes, logicalLength: value.length })
        : err(fieldFailure(field, "hostMessage.field.decodeFailed", "Hex field is invalid"));
    }
    case "bcd":
      return typeof value === "string"
        ? encodeBcd(value, field)
        : err(fieldFailure(field, "hostMessage.field.validationFailed", "BCD field requires a string"));
    case "custom": {
      const codec = fieldCodecs.get(field.encoding.codecId, field.encoding.codecVersion);
      if (!codec) {
        return err(fieldFailure(field, "hostMessage.field.codecMissing", "Field codec is unavailable"));
      }
      try {
        return codec.encode(value as string | Uint8Array, { field });
      } catch {
        return err(fieldFailure(field, "hostMessage.field.codecFailed", "Field codec failed"));
      }
    }
  }
};

export const decodeFieldValue = (
  field: HostFieldDefinition,
  bytes: Uint8Array,
  fieldCodecs: FieldCodecLookup,
  logicalLength?: number,
): FieldResult<string | Uint8Array> => {
  const context: FieldCodecContext = {
    field,
    ...(logicalLength === undefined ? {} : { logicalLength }),
  };
  switch (field.encoding.kind) {
    case "ascii":
      return [...bytes].some((value) => value > 0x7f)
        ? err(fieldFailure(field, "hostMessage.field.decodeFailed", "ASCII field is invalid"))
        : ok(String.fromCharCode(...bytes));
    case "utf8":
      try {
        return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        return err(fieldFailure(field, "hostMessage.field.decodeFailed", "UTF-8 field is invalid"));
      }
    case "binary":
      return ok(bytes.slice());
    case "ascii-hex":
      return ok(bytesToHex(bytes));
    case "bcd":
      return decodeBcd(bytes, field, logicalLength);
    case "custom": {
      const codec = fieldCodecs.get(field.encoding.codecId, field.encoding.codecVersion);
      if (!codec) {
        return err(fieldFailure(field, "hostMessage.field.codecMissing", "Field codec is unavailable"));
      }
      try {
        return codec.decode(bytes, context);
      } catch {
        return err(fieldFailure(field, "hostMessage.field.codecFailed", "Field codec failed"));
      }
    }
  }
};
