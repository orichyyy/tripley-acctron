import { err, ok, type Result } from "@tripley-kit/web-container-types";
import { ByteCursor, concatBytes, decodeDecimalLength, encodeDecimalLength } from "./bytes";
import type {
  FieldCodecLookup,
  HostFieldDefinition,
  HostFieldValue,
  HostMessageFailure,
} from "./contracts";
import { decodeFieldValue, encodeFieldValue } from "./field-codecs";
import { hostMessageFailure } from "./failures";

interface PackedField {
  readonly bytes: Uint8Array;
}

interface UnpackedField {
  readonly value: string | Uint8Array;
}

type WireResult<T> = Result<T, HostMessageFailure>;

const fail = (field: HostFieldDefinition, code: string, message: string, offset?: number) =>
  hostMessageFailure(code, message, {
    ...(field.dataElement === undefined ? {} : { dataElement: field.dataElement }),
    ...(offset === undefined ? {} : { byteOffset: offset }),
    fieldId: field.id,
    phase: "fieldValue",
  });

const validateValue = (field: HostFieldDefinition, value: string | Uint8Array): HostMessageFailure | undefined => {
  const logicalLength = typeof value === "string" ? value.length : value.byteLength;
  if (field.allowBlank !== true && typeof value === "string" && value.length === 0) {
    return fail(field, "hostMessage.field.validationFailed", "Field cannot be blank");
  }
  const validation = field.validation;
  if (!validation) {
    return undefined;
  }
  if (validation.minLength !== undefined && logicalLength < validation.minLength) {
    return fail(field, "hostMessage.field.validationFailed", "Field is shorter than allowed");
  }
  if (validation.maxLength !== undefined && logicalLength > validation.maxLength) {
    return fail(field, "hostMessage.field.validationFailed", "Field is longer than allowed");
  }
  if (typeof value === "string") {
    if (validation.allowedValues && !validation.allowedValues.includes(value)) {
      return fail(field, "hostMessage.field.validationFailed", "Field value is not allowed");
    }
    if (validation.pattern && !new RegExp(validation.pattern).test(value)) {
      return fail(field, "hostMessage.field.validationFailed", "Field format is invalid");
    }
  }
  return undefined;
};

const padBytes = (bytes: Uint8Array, field: HostFieldDefinition, length: number): WireResult<Uint8Array> => {
  if (bytes.length === length) {
    return ok(bytes);
  }
  if (bytes.length > length) {
    return err(fail(field, "hostMessage.field.overflow", "Field exceeds its fixed wire length"));
  }
  if (!field.padding) {
    return err(fail(field, "hostMessage.field.lengthMismatch", "Field does not fill its fixed wire length"));
  }
  const padding = new Uint8Array(length - bytes.length).fill(field.padding.byte);
  return ok(field.padding.direction === "left" ? concatBytes([padding, bytes]) : concatBytes([bytes, padding]));
};

const stripPadding = (bytes: Uint8Array, field: HostFieldDefinition): Uint8Array => {
  if (!field.padding?.stripOnDecode) {
    return bytes;
  }
  let start = 0;
  let end = bytes.length;
  if (field.padding.direction === "left") {
    while (start < end && bytes[start] === field.padding.byte) start += 1;
  } else {
    while (end > start && bytes[end - 1] === field.padding.byte) end -= 1;
  }
  return bytes.slice(start, end);
};

export const packWireField = (
  field: HostFieldDefinition,
  value: HostFieldValue,
  fieldCodecs: FieldCodecLookup,
): WireResult<PackedField> => {
  if (Array.isArray(value)) {
    return err(fail(field, "hostMessage.field.validationFailed", "Field requires a scalar value"));
  }
  const validationFailure = validateValue(field, value as string | Uint8Array);
  if (validationFailure) return err(validationFailure);
  const encoded = encodeFieldValue(field, value, fieldCodecs);
  if (!encoded.ok) return encoded;

  if (field.length.kind === "fixed") {
    const padded = padBytes(encoded.value.bytes, field, field.length.bytes);
    return padded.ok ? ok({ bytes: padded.value }) : padded;
  }

  const logicalLength = field.length.lengthUnit === "digits"
    ? encoded.value.logicalLength
    : encoded.value.bytes.length;
  if (logicalLength > field.length.maxLength) {
    return err(fail(field, "hostMessage.limit.exceeded", "Field exceeds its variable wire limit"));
  }
  const width = field.length.kind === "llvar" ? 2 : 3;
  const prefix = encodeDecimalLength(logicalLength, width, field.length.lengthEncoding);
  return prefix instanceof Uint8Array
    ? ok({ bytes: concatBytes([prefix, encoded.value.bytes]) })
    : err({ ...prefix, fieldId: field.id });
};

export const unpackWireField = (
  cursor: ByteCursor,
  field: HostFieldDefinition,
  fieldCodecs: FieldCodecLookup,
): WireResult<UnpackedField> => {
  const start = cursor.offset;
  let logicalLength: number | undefined;
  let wireLength: number;

  if (field.length.kind === "fixed") {
    wireLength = field.length.bytes;
    if (field.encoding.kind === "bcd") logicalLength = field.encoding.digitCount;
  } else {
    const width = field.length.kind === "llvar" ? 2 : 3;
    const prefixBytes = field.length.lengthEncoding === "ascii" ? width : Math.ceil(width / 2);
    const prefix = cursor.read(prefixBytes);
    if (!prefix) {
      return err(fail(field, "hostMessage.message.truncated", "Field length prefix is incomplete", start));
    }
    const decodedLength = decodeDecimalLength(prefix, width, field.length.lengthEncoding);
    if (typeof decodedLength !== "number") {
      return err({ ...decodedLength, fieldId: field.id, byteOffset: start });
    }
    if (decodedLength > field.length.maxLength) {
      return err(hostMessageFailure("hostMessage.limit.exceeded", "Field length exceeds its profile limit", {
        actual: decodedLength,
        byteOffset: start,
        fieldId: field.id,
        limit: field.length.maxLength,
        phase: "lengthPrefix",
      }));
    }
    logicalLength = field.length.lengthUnit === "digits" ? decodedLength : undefined;
    wireLength = field.length.lengthUnit === "digits" && field.encoding.kind === "bcd"
      ? Math.ceil(decodedLength / 2)
      : decodedLength;
  }

  const available = cursor.remaining;
  const raw = cursor.read(wireLength);
  if (!raw) {
    return err(hostMessageFailure("hostMessage.message.truncated", "Field body is incomplete", {
      ...(field.dataElement === undefined ? {} : { dataElement: field.dataElement }),
      byteOffset: cursor.offset,
      expectedBytes: wireLength,
      fieldId: field.id,
      phase: "fieldValue",
      receivedBytes: available,
    }));
  }
  const decoded = decodeFieldValue(field, stripPadding(raw, field), fieldCodecs, logicalLength);
  if (!decoded.ok) return decoded;
  const validationFailure = validateValue(field, decoded.value);
  return validationFailure ? err(validationFailure) : ok({ value: decoded.value });
};
