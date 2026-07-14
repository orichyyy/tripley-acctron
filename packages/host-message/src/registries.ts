import { FrameworkError } from "@tripley/web-container-errors";
import type {
  FieldCodec,
  FieldCodecLookup,
  HostMessageCodec,
  HostMessageProfile,
  HostMessageReference,
  ResolvedHostMessageDefinition,
  ServiceLimits,
} from "./contracts";

const configurationError = (code: string, message: string, metadata: Record<string, string | number>) =>
  new FrameworkError({ category: "configuration", code, message, metadata });

class FreezableRegistry {
  protected frozen = false;

  public freeze(): void {
    this.frozen = true;
  }

  protected assertMutable(name: string): void {
    if (this.frozen) {
      throw configurationError("hostMessage.registry.frozen", `${name} is frozen`, { registry: name });
    }
  }
}

export class FieldCodecRegistry extends FreezableRegistry implements FieldCodecLookup {
  private readonly codecs = new Map<string, FieldCodec>();

  public register(codec: FieldCodec): void {
    this.assertMutable("FieldCodecRegistry");
    const key = this.key(codec.id, codec.version);
    if (this.codecs.has(key)) {
      throw configurationError("hostMessage.registry.duplicateFieldCodec", "Field codec is already registered", { key });
    }
    this.codecs.set(key, codec);
  }

  public get(id: string, version: string): FieldCodec | undefined {
    return this.codecs.get(this.key(id, version));
  }

  private key(id: string, version: string): string {
    return `${id}@${version}`;
  }
}

export class HostMessageCodecRegistry extends FreezableRegistry {
  private readonly codecs = new Map<string, HostMessageCodec>();

  public register(codec: HostMessageCodec): void {
    this.assertMutable("HostMessageCodecRegistry");
    if (this.codecs.has(codec.id)) {
      throw configurationError("hostMessage.registry.duplicateCodec", "Message codec is already registered", { codecId: codec.id });
    }
    this.codecs.set(codec.id, codec);
  }

  public get(id: string): HostMessageCodec | undefined {
    return this.codecs.get(id);
  }
}

export class HostMessageProfileRegistry extends FreezableRegistry {
  private readonly definitions = new Map<string, ResolvedHostMessageDefinition>();

  public constructor(
    private readonly codecs: HostMessageCodecRegistry,
    private readonly fieldCodecs: FieldCodecRegistry,
    private readonly limits: ServiceLimits,
  ) {
    super();
  }

  public register(profile: HostMessageProfile): void {
    this.assertMutable("HostMessageProfileRegistry");
    this.validateProfile(profile);
    const fieldsById = new Map(profile.fieldDefinitions.map((field) => [field.id, field]));
    for (const message of profile.messages) {
      const key = this.key({ profileId: profile.id, profileVersion: profile.version, messageId: message.id });
      if (this.definitions.has(key)) {
        throw configurationError("hostMessage.registry.duplicateMessage", "Message definition is already registered", { key });
      }
      this.definitions.set(key, { fieldsById, message, profile });
    }
    deepFreeze(profile);
  }

  public get(reference: HostMessageReference): ResolvedHostMessageDefinition | undefined {
    return this.definitions.get(this.key(reference));
  }

  private key(reference: HostMessageReference): string {
    return `${reference.profileId}@${reference.profileVersion}:${reference.messageId}`;
  }

  private validateProfile(profile: HostMessageProfile): void {
    if (!profile.id || !profile.version || !this.codecs.get(profile.codecId)) {
      throw configurationError("hostMessage.profile.invalid", "Profile identity or codec is invalid", { profileId: profile.id || "<empty>" });
    }
    if (profile.maxMessageBytes <= 0 || profile.maxMessageBytes > this.limits.maxMessageBytes) {
      throw configurationError("hostMessage.profile.messageLimit", "Profile message limit is invalid", { profileId: profile.id });
    }
    if (profile.fieldDefinitions.length > this.limits.maxFixedFields) {
      throw configurationError("hostMessage.profile.fieldLimit", "Profile has too many fields", { profileId: profile.id });
    }
    const fields = new Map<string, HostMessageProfile["fieldDefinitions"][number]>();
    const dataElements = new Set<number>();
    for (const field of profile.fieldDefinitions) {
      if (!field.id || fields.has(field.id)) {
        throw configurationError("hostMessage.profile.duplicateField", "Profile field ID is invalid or duplicated", { fieldId: field.id || "<empty>" });
      }
      fields.set(field.id, field);
      if (field.dataElement !== undefined) {
        if (field.dataElement < 2 || field.dataElement > 128 || dataElements.has(field.dataElement)) {
          throw configurationError("hostMessage.profile.dataElement", "ISO data element is invalid or duplicated", { fieldId: field.id });
        }
        dataElements.add(field.dataElement);
      }
      this.validateField(field);
    }
    const messageIds = new Set<string>();
    for (const message of profile.messages) {
      if (!message.id || messageIds.has(message.id)) {
        throw configurationError("hostMessage.profile.duplicateMessage", "Message ID is invalid or duplicated", { messageId: message.id || "<empty>" });
      }
      messageIds.add(message.id);
      this.validateMessage(profile, message, fields);
    }
  }

  private validateField(field: HostMessageProfile["fieldDefinitions"][number]): void {
    const length = field.length.kind === "fixed" ? field.length.bytes : field.length.maxLength;
    if (!Number.isInteger(length) || length < 0 || length > this.limits.maxMessageBytes) {
      throw configurationError("hostMessage.profile.fieldLength", "Field length is invalid", { fieldId: field.id });
    }
    if (field.padding && (field.padding.byte < 0 || field.padding.byte > 255)) {
      throw configurationError("hostMessage.profile.padding", "Field padding byte is invalid", { fieldId: field.id });
    }
    if (field.encoding.kind === "bcd") {
      const nibble = field.encoding.padNibble ?? 0;
      if (nibble < 0 || nibble > 15 || (field.encoding.digitCount !== undefined && field.encoding.digitCount < 0)) {
        throw configurationError("hostMessage.profile.bcd", "BCD settings are invalid", { fieldId: field.id });
      }
    }
    if (field.encoding.kind === "custom" && !this.fieldCodecs.get(field.encoding.codecId, field.encoding.codecVersion)) {
      throw configurationError("hostMessage.profile.fieldCodecMissing", "Profile field codec is unavailable", { fieldId: field.id });
    }
    if (field.safeSummary?.mode === "value" && (field.dataClassification === "sensitive" || field.dataClassification === "secret")) {
      throw configurationError("hostMessage.profile.unsafeSummary", "Sensitive field cannot use value summaries", { fieldId: field.id });
    }
    if (field.validation?.pattern) {
      try {
        new RegExp(field.validation.pattern);
      } catch {
        throw configurationError("hostMessage.profile.validation", "Field validation pattern is invalid", { fieldId: field.id });
      }
    }
  }

  private validateMessage(
    profile: HostMessageProfile,
    message: HostMessageProfile["messages"][number],
    fields: ReadonlyMap<string, HostMessageProfile["fieldDefinitions"][number]>,
  ): void {
    const used = new Set<string>();
    let optionalTail = false;
    for (const use of message.fields) {
      if (use.kind === "field") {
        const field = fields.get(use.fieldId);
        if (!field || used.has(use.fieldId)) {
          throw configurationError("hostMessage.profile.messageField", "Message field is missing or duplicated", { messageId: message.id });
        }
        used.add(use.fieldId);
        optionalTail ||= use.presence === "optionalTrailing";
        if (profile.codecId === "fixed-field" && optionalTail && use.presence !== "optionalTrailing") {
          throw configurationError("hostMessage.profile.optionalTail", "Optional trailing fields must remain at the tail", { messageId: message.id });
        }
      } else {
        if (profile.codecId !== "fixed-field" || use.maxItems <= 0 || use.maxItems > this.limits.maxRepeatItems) {
          throw configurationError("hostMessage.profile.repeatingGroup", "Repeating group is invalid", { messageId: message.id });
        }
        for (const fieldId of [use.countFieldId, ...use.itemFieldIds]) {
          if (!fields.has(fieldId)) {
            throw configurationError("hostMessage.profile.repeatingField", "Repeating group field is missing", { messageId: message.id });
          }
        }
      }
    }
    if (profile.codecId === "iso8583") {
      if (!message.mti || !/^\d{4}$/.test(message.mti) || message.fields.some((use) => use.kind !== "field")) {
        throw configurationError("hostMessage.profile.isoMessage", "ISO message definition is invalid", { messageId: message.id });
      }
      for (const use of message.fields) {
        if (use.kind === "field" && fields.get(use.fieldId)?.dataElement === undefined) {
          throw configurationError("hostMessage.profile.isoField", "ISO message field lacks a data element", { fieldId: use.fieldId });
        }
      }
    }
  }
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};
