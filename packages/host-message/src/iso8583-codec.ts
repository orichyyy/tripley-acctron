import { ByteCursor, bytesToHex, concatBytes, hexToBytes } from "./bytes";
import type {
  HostFieldSet,
  HostFieldValue,
  HostMessageCodec,
  HostMessageCodecPackContext,
  HostMessageCodecUnpackContext,
  HostMessageDecodeResult,
  HostMessageFailure,
  HostMessagePackResult,
  ScalarFieldUse,
} from "./contracts";
import { addFailureDetails, canReturnPartial, hostMessageFailure, referenceDetails } from "./failures";
import { packWireField, unpackWireField } from "./field-wire";

export class Iso8583MessageCodec implements HostMessageCodec {
  public readonly id = "iso8583";
  public readonly builtIn = true;

  public pack(context: HostMessageCodecPackContext): HostMessagePackResult {
    const message = context.resolved.message;
    if (!message.mti) return this.packFailure(context, "hostMessage.profile.invalid", "ISO MTI is missing");
    const uses = this.isoUses(context);
    if ("category" in uses) return { status: "failed", error: uses };
    const present: Array<{ use: ScalarFieldUse; dataElement: number }> = [];
    for (const entry of uses) {
      const value = context.fields[entry.use.fieldId];
      const presence = entry.use.presence ?? "optional";
      if (presence === "forbidden" && value !== undefined) {
        return this.packFailure(context, "hostMessage.iso.forbiddenField", "Forbidden ISO field is present", entry.use.fieldId);
      }
      if (presence === "required" && value === undefined) {
        return this.packFailure(context, "hostMessage.field.missing", "Required ISO field is missing", entry.use.fieldId);
      }
      if (value !== undefined && presence !== "forbidden") present.push(entry);
    }
    present.sort((left, right) => left.dataElement - right.dataElement);
    const hasSecondary = present.some((entry) => entry.dataElement > 64);
    const bitmap = new Uint8Array(hasSecondary ? 16 : 8);
    if (hasSecondary) bitmap[0] = 0x80;
    for (const entry of present) setBitmapBit(bitmap, entry.dataElement);
    const mti = encodeMti(message.mti, message.mtiEncoding ?? "ascii");
    const bitmapBytes = message.bitmapEncoding === "ascii-hex"
      ? new TextEncoder().encode(bytesToHex(bitmap))
      : bitmap;
    const parts = [mti, bitmapBytes];
    for (const entry of present) {
      const field = context.resolved.fieldsById.get(entry.use.fieldId);
      const value = context.fields[entry.use.fieldId];
      if (!field || value === undefined) return this.packFailure(context, "hostMessage.profile.invalid", "ISO field is unresolved");
      const packed = packWireField(field, value, context.fieldCodecs);
      if (!packed.ok) return { status: "failed", error: addFailureDetails(packed.error, referenceDetails(context.reference)) };
      parts.push(packed.value.bytes);
    }
    const bytes = concatBytes(parts);
    if (bytes.length > context.resolved.profile.maxMessageBytes || bytes.length > context.limits.maxMessageBytes) {
      return this.packFailure(context, "hostMessage.limit.exceeded", "Packed ISO message exceeds its wire limit");
    }
    return { status: "packed", message: { bytes, reference: context.reference } };
  }

  public unpack(context: HostMessageCodecUnpackContext): HostMessageDecodeResult {
    const message = context.resolved.message;
    if (!message.mti) return this.hardFailure(context, "hostMessage.profile.invalid", "ISO MTI is missing");
    const cursor = new ByteCursor(context.bytes);
    const mtiLength = (message.mtiEncoding ?? "ascii") === "ascii" ? 4 : 2;
    const rawMti = cursor.read(mtiLength);
    if (!rawMti) return this.headerPartial(context, {}, cursor, "mti", mtiLength);
    const mti = decodeMti(rawMti, message.mtiEncoding ?? "ascii");
    if (mti !== message.mti) return this.hardFailure(context, "hostMessage.iso.mtiInvalid", "ISO MTI does not match the message definition");

    const primary = this.readBitmapPart(context, cursor, "primaryBitmap");
    if (primary instanceof Object && "status" in primary) return primary;
    const bitmapParts: Uint8Array[] = [primary as Uint8Array];
    if (((primary as Uint8Array)[0] ?? 0) & 0x80) {
      const secondary = this.readBitmapPart(context, cursor, "secondaryBitmap");
      if (secondary instanceof Object && "status" in secondary) return secondary;
      bitmapParts.push(secondary as Uint8Array);
    }
    const bitmap = concatBytes(bitmapParts);
    const uses = this.isoUses(context);
    if ("category" in uses) return { status: "failed", error: uses };
    const byElement = new Map(uses.map((entry) => [entry.dataElement, entry.use]));
    const presentElements = readBitmapElements(bitmap);
    for (const dataElement of presentElements) {
      if (!byElement.has(dataElement)) {
        return this.hardFailure(context, "hostMessage.iso.undefinedDataElement", "Bitmap references an undefined data element", { dataElement });
      }
    }
    for (const entry of uses) {
      if ((entry.use.presence ?? "optional") === "required" && !presentElements.includes(entry.dataElement)) {
        return this.hardFailure(context, "hostMessage.iso.requiredFieldMissing", "Bitmap omits a required data element", { dataElement: entry.dataElement, fieldId: entry.use.fieldId });
      }
    }
    const fields: Record<string, HostFieldValue> = {};
    for (let fieldIndex = 0; fieldIndex < presentElements.length; fieldIndex += 1) {
      const dataElement = presentElements[fieldIndex];
      if (dataElement === undefined) continue;
      const use = byElement.get(dataElement);
      const field = use ? context.resolved.fieldsById.get(use.fieldId) : undefined;
      if (!use || !field) return this.hardFailure(context, "hostMessage.profile.invalid", "ISO field is unresolved");
      if (use.presence === "forbidden") return this.hardFailure(context, "hostMessage.iso.forbiddenField", "Bitmap contains a forbidden field", { dataElement, fieldId: use.fieldId });
      const decoded = unpackWireField(cursor, field, context.fieldCodecs);
      if (!decoded.ok) {
        const error = addFailureDetails(decoded.error, { ...referenceDetails(context.reference), dataElement, fieldIndex });
        return context.allowPartial && canReturnPartial(error)
          ? { status: "partial", reference: context.reference, fields, failure: error, consumedBytes: cursor.offset, receivedBytes: context.bytes.length }
          : { status: "failed", error };
      }
      fields[use.fieldId] = decoded.value.value;
    }
    if (cursor.remaining !== 0) return this.hardFailure(context, "hostMessage.message.trailingBytes", "ISO message contains trailing bytes", { actual: cursor.remaining, byteOffset: cursor.offset });
    return { status: "complete", message: { fields, reference: context.reference, wireLength: context.bytes.length } };
  }

  private isoUses(context: HostMessageCodecPackContext | HostMessageCodecUnpackContext): Array<{ use: ScalarFieldUse; dataElement: number }> | HostMessageFailure {
    const result: Array<{ use: ScalarFieldUse; dataElement: number }> = [];
    for (const use of context.resolved.message.fields) {
      if (use.kind !== "field") return hostMessageFailure("hostMessage.profile.invalid", "ISO message contains a repeating group", referenceDetails(context.reference));
      const dataElement = context.resolved.fieldsById.get(use.fieldId)?.dataElement;
      if (dataElement === undefined) return hostMessageFailure("hostMessage.profile.invalid", "ISO field lacks a data element", referenceDetails(context.reference));
      result.push({ dataElement, use });
    }
    return result;
  }

  private readBitmapPart(context: HostMessageCodecUnpackContext, cursor: ByteCursor, phase: string): Uint8Array | HostMessageDecodeResult {
    const encoding = context.resolved.message.bitmapEncoding ?? "binary";
    const wireLength = encoding === "binary" ? 8 : 16;
    const raw = cursor.read(wireLength);
    if (!raw) return this.headerPartial(context, {}, cursor, phase, wireLength);
    if (encoding === "binary") return raw;
    const decoded = hexToBytes(new TextDecoder().decode(raw));
    return decoded ?? this.hardFailure(context, "hostMessage.iso.bitmapInvalid", "ASCII-hex bitmap is invalid", { phase });
  }

  private headerPartial(context: HostMessageCodecUnpackContext, fields: HostFieldSet, cursor: ByteCursor, phase: string, expectedBytes: number): HostMessageDecodeResult {
    const error = hostMessageFailure("hostMessage.message.truncated", "ISO header is incomplete", {
      ...referenceDetails(context.reference), byteOffset: cursor.offset, expectedBytes, phase, receivedBytes: cursor.remaining,
    });
    return context.allowPartial
      ? { status: "partial", reference: context.reference, fields, failure: error, consumedBytes: cursor.offset, receivedBytes: context.bytes.length }
      : { status: "failed", error };
  }

  private packFailure(context: HostMessageCodecPackContext, code: string, message: string, fieldId?: string): HostMessagePackResult {
    return { status: "failed", error: hostMessageFailure(code, message, { ...referenceDetails(context.reference), ...(fieldId ? { fieldId } : {}) }) };
  }

  private hardFailure(context: HostMessageCodecUnpackContext, code: string, message: string, details: Partial<HostMessageFailure> = {}): HostMessageDecodeResult {
    return { status: "failed", error: hostMessageFailure(code, message, { ...referenceDetails(context.reference), ...details }) };
  }
}

const setBitmapBit = (bitmap: Uint8Array, dataElement: number): void => {
  const index = dataElement - 1;
  const byteIndex = Math.floor(index / 8);
  const mask = 0x80 >> (index % 8);
  bitmap[byteIndex] = (bitmap[byteIndex] ?? 0) | mask;
};

const readBitmapElements = (bitmap: Uint8Array): number[] => {
  const result: number[] = [];
  for (let dataElement = 2; dataElement <= bitmap.length * 8; dataElement += 1) {
    const index = dataElement - 1;
    if (((bitmap[Math.floor(index / 8)] ?? 0) & (0x80 >> (index % 8))) !== 0) result.push(dataElement);
  }
  return result;
};

const encodeMti = (mti: string, encoding: "ascii" | "bcd"): Uint8Array =>
  encoding === "ascii"
    ? new TextEncoder().encode(mti)
    : hexToBytes(mti) ?? new Uint8Array();

const decodeMti = (bytes: Uint8Array, encoding: "ascii" | "bcd"): string =>
  encoding === "ascii" ? new TextDecoder().decode(bytes) : bytesToHex(bytes);
