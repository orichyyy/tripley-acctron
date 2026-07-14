import { ByteCursor, concatBytes } from "./bytes";
import type {
  HostFieldSet,
  HostFieldValue,
  HostMessageCodec,
  HostMessageCodecPackContext,
  HostMessageCodecUnpackContext,
  HostMessageDecodeResult,
  HostMessageFailure,
  HostMessagePackResult,
  RepeatingGroupUse,
} from "./contracts";
import { addFailureDetails, canReturnPartial, hostMessageFailure, referenceDetails } from "./failures";
import { packWireField, unpackWireField } from "./field-wire";

export class FixedFieldMessageCodec implements HostMessageCodec {
  public readonly id = "fixed-field";
  public readonly builtIn = true;

  public pack(context: HostMessageCodecPackContext): HostMessagePackResult {
    const parts: Uint8Array[] = [];
    for (const use of context.resolved.message.fields) {
      if (use.kind === "field") {
        if (use.presence === "forbidden") continue;
        const value = context.fields[use.fieldId];
        if (value === undefined) {
          if (use.presence === "optional" || use.presence === "optionalTrailing") continue;
          return this.packFailure(context, "hostMessage.field.missing", "Required field is missing", use.fieldId);
        }
        const field = context.resolved.fieldsById.get(use.fieldId);
        if (!field) return this.packFailure(context, "hostMessage.profile.invalid", "Field definition is missing", use.fieldId);
        const packed = packWireField(field, value, context.fieldCodecs);
        if (!packed.ok) return { status: "failed", error: addFailureDetails(packed.error, referenceDetails(context.reference)) };
        parts.push(packed.value.bytes);
      } else {
        const packed = this.packGroup(context, use);
        if ("category" in packed) return { status: "failed", error: packed };
        parts.push(packed);
      }
    }
    const bytes = concatBytes(parts);
    if (bytes.length > context.resolved.profile.maxMessageBytes || bytes.length > context.limits.maxMessageBytes) {
      return this.packFailure(context, "hostMessage.limit.exceeded", "Packed message exceeds its wire limit");
    }
    return { status: "packed", message: { bytes, reference: context.reference } };
  }

  public unpack(context: HostMessageCodecUnpackContext): HostMessageDecodeResult {
    const cursor = new ByteCursor(context.bytes);
    const fields: Record<string, HostFieldValue> = {};
    for (let fieldIndex = 0; fieldIndex < context.resolved.message.fields.length; fieldIndex += 1) {
      const use = context.resolved.message.fields[fieldIndex];
      if (!use) continue;
      if (use.kind === "field") {
        if (use.presence === "forbidden") continue;
        if (cursor.remaining === 0 && use.presence === "optionalTrailing") continue;
        const field = context.resolved.fieldsById.get(use.fieldId);
        if (!field) return this.hardFailure(context, "hostMessage.profile.invalid", "Field definition is missing");
        const decoded = unpackWireField(cursor, field, context.fieldCodecs);
        if (!decoded.ok) return this.decodeFailure(context, fields, decoded.error, cursor, fieldIndex);
        fields[use.fieldId] = decoded.value.value;
      } else {
        if (cursor.remaining === 0 && use.presence === "optionalTrailing") continue;
        const decoded = this.unpackGroup(context, use, cursor, fields, fieldIndex);
        if (decoded) return decoded;
      }
    }
    if (cursor.remaining !== 0) {
      return this.hardFailure(context, "hostMessage.message.trailingBytes", "Message contains trailing bytes", {
        actual: cursor.remaining,
        byteOffset: cursor.offset,
      });
    }
    return {
      status: "complete",
      message: { fields, reference: context.reference, wireLength: context.bytes.length },
    };
  }

  private packGroup(context: HostMessageCodecPackContext, use: RepeatingGroupUse): Uint8Array | HostMessageFailure {
    const value = context.fields[use.id];
    if (value === undefined && use.presence === "optionalTrailing") return new Uint8Array();
    if (!Array.isArray(value)) {
      return hostMessageFailure("hostMessage.field.validationFailed", "Repeating group requires an item array", {
        ...referenceDetails(context.reference), groupId: use.id,
      });
    }
    if (value.length > use.maxItems || value.length > context.limits.maxRepeatItems) {
      return hostMessageFailure("hostMessage.limit.exceeded", "Repeating group exceeds its item limit", {
        ...referenceDetails(context.reference), actual: value.length, groupId: use.id, limit: use.maxItems,
      });
    }
    const countField = context.resolved.fieldsById.get(use.countFieldId);
    if (!countField) return hostMessageFailure("hostMessage.profile.invalid", "Count field is missing", referenceDetails(context.reference));
    const count = packWireField(countField, String(value.length), context.fieldCodecs);
    if (!count.ok) return addFailureDetails(count.error, { ...referenceDetails(context.reference), groupId: use.id });
    const itemParts: Uint8Array[] = [];
    for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
      const item = value[itemIndex];
      if (!item) continue;
      for (const itemFieldId of use.itemFieldIds) {
        const field = context.resolved.fieldsById.get(itemFieldId);
        const itemValue = item[itemFieldId];
        if (!field || itemValue === undefined) {
          return hostMessageFailure("hostMessage.field.missing", "Repeating item field is missing", {
            ...referenceDetails(context.reference), groupId: use.id, itemFieldId, itemIndex,
          });
        }
        const packed = packWireField(field, itemValue, context.fieldCodecs);
        if (!packed.ok) return addFailureDetails(packed.error, { groupId: use.id, itemFieldId, itemIndex });
        itemParts.push(packed.value.bytes);
      }
    }
    let itemBytes = concatBytes(itemParts);
    if (use.fixedAreaBytes !== undefined) {
      if (itemBytes.length > use.fixedAreaBytes) {
        return hostMessageFailure("hostMessage.limit.exceeded", "Repeating group exceeds its fixed area", {
          ...referenceDetails(context.reference), actual: itemBytes.length, groupId: use.id, limit: use.fixedAreaBytes,
        });
      }
      const padding = new Uint8Array(use.fixedAreaBytes - itemBytes.length).fill(use.padByte ?? 0x20);
      itemBytes = concatBytes([itemBytes, padding]);
    }
    return concatBytes([count.value.bytes, itemBytes]);
  }

  private unpackGroup(
    context: HostMessageCodecUnpackContext,
    use: RepeatingGroupUse,
    cursor: ByteCursor,
    output: Record<string, HostFieldValue>,
    fieldIndex: number,
  ): HostMessageDecodeResult | undefined {
    const countField = context.resolved.fieldsById.get(use.countFieldId);
    if (!countField) return this.hardFailure(context, "hostMessage.profile.invalid", "Count field is missing");
    const groupStart = cursor.offset;
    const count = unpackWireField(cursor, countField, context.fieldCodecs);
    if (!count.ok) return this.decodeFailure(context, output, addFailureDetails(count.error, { groupId: use.id }), cursor, fieldIndex);
    if (typeof count.value.value !== "string" || !/^\d+$/.test(count.value.value)) {
      const failure = hostMessageFailure("hostMessage.field.validationFailed", "Repeating count is invalid", {
        byteOffset: groupStart, fieldId: countField.id, groupId: use.id, phase: "repeatCount",
      });
      return this.decodeFailure(context, output, failure, cursor, fieldIndex);
    }
    const countValue = Number.parseInt(count.value.value, 10);
    if (countValue > use.maxItems || countValue > context.limits.maxRepeatItems) {
      return this.hardFailure(context, "hostMessage.limit.exceeded", "Repeating count exceeds its limit", {
        actual: countValue, groupId: use.id, limit: use.maxItems,
      });
    }
    output[use.countFieldId] = count.value.value;
    const areaStart = cursor.offset;
    const items: HostFieldSet[] = [];
    for (let itemIndex = 0; itemIndex < countValue; itemIndex += 1) {
      const item: Record<string, HostFieldValue> = {};
      for (const itemFieldId of use.itemFieldIds) {
        const field = context.resolved.fieldsById.get(itemFieldId);
        if (!field) return this.hardFailure(context, "hostMessage.profile.invalid", "Repeating field is missing");
        const decoded = unpackWireField(cursor, field, context.fieldCodecs);
        if (!decoded.ok) {
          const failure = addFailureDetails(decoded.error, { groupId: use.id, itemFieldId, itemIndex });
          return this.decodeFailure(context, output, failure, cursor, fieldIndex);
        }
        item[itemFieldId] = decoded.value.value;
      }
      items.push(item);
    }
    if (use.fixedAreaBytes !== undefined) {
      const consumed = cursor.offset - areaStart;
      const padding = use.fixedAreaBytes - consumed;
      if (padding < 0) return this.hardFailure(context, "hostMessage.limit.exceeded", "Repeating area is exceeded");
      const available = cursor.remaining;
      if (!cursor.read(padding)) {
        const failure = hostMessageFailure("hostMessage.message.truncated", "Repeating fixed area is incomplete", {
          byteOffset: cursor.offset, expectedBytes: padding, groupId: use.id, phase: "repeatPadding", receivedBytes: available,
        });
        return this.decodeFailure(context, output, failure, cursor, fieldIndex);
      }
    }
    output[use.id] = items;
    return undefined;
  }

  private decodeFailure(
    context: HostMessageCodecUnpackContext,
    fields: HostFieldSet,
    failure: HostMessageFailure,
    cursor: ByteCursor,
    fieldIndex: number,
  ): HostMessageDecodeResult {
    const error = addFailureDetails(failure, { ...referenceDetails(context.reference), fieldIndex });
    return context.allowPartial && canReturnPartial(error)
      ? { status: "partial", reference: context.reference, fields, failure: error, consumedBytes: cursor.offset, receivedBytes: context.bytes.length }
      : { status: "failed", error };
  }

  private packFailure(context: HostMessageCodecPackContext, code: string, message: string, fieldId?: string): HostMessagePackResult {
    return { status: "failed", error: hostMessageFailure(code, message, {
      ...referenceDetails(context.reference), ...(fieldId === undefined ? {} : { fieldId }),
    }) };
  }

  private hardFailure(
    context: HostMessageCodecUnpackContext,
    code: string,
    message: string,
    details: Partial<HostMessageFailure> = {},
  ): HostMessageDecodeResult {
    return { status: "failed", error: hostMessageFailure(code, message, { ...referenceDetails(context.reference), ...details }) };
  }
}
