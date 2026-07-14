import { FrameworkError } from "@tripley/web-container-errors";
import type {
  FieldCodec,
  HostMessageCodec,
  HostMessageDecodeResult,
  HostMessageFailure,
  HostMessagePackResult,
  HostMessageProfile,
  HostMessageService,
  PackHostMessageInput,
  SafeHostMessageSummary,
  ServiceLimits,
  UnpackedHostMessage,
  UnpackHostMessageInput,
} from "./contracts";
import { FixedFieldMessageCodec } from "./fixed-field-codec";
import { hostMessageFailure, referenceDetails } from "./failures";
import { Iso8583MessageCodec } from "./iso8583-codec";
import { FieldCodecRegistry, HostMessageCodecRegistry, HostMessageProfileRegistry } from "./registries";
import { createSafeSummary } from "./safety";

export const ABSOLUTE_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export const DEFAULT_SERVICE_LIMITS: ServiceLimits = Object.freeze({
  maxFixedFields: 512,
  maxMessageBytes: 64 * 1024,
  maxRepeatDepth: 1,
  maxRepeatItems: 256,
});

export interface CreateHostMessageServiceOptions {
  readonly allowPartial?: boolean;
  readonly fieldCodecs?: readonly FieldCodec[];
  readonly limits?: Partial<ServiceLimits>;
  readonly messageCodecs?: readonly HostMessageCodec[];
  readonly profiles: readonly HostMessageProfile[];
}

export interface HostMessageRuntime {
  readonly codecs: HostMessageCodecRegistry;
  readonly fieldCodecs: FieldCodecRegistry;
  readonly profiles: HostMessageProfileRegistry;
  readonly service: HostMessageService;
}

class DefaultHostMessageService implements HostMessageService {
  public constructor(
    private readonly profiles: HostMessageProfileRegistry,
    private readonly codecs: HostMessageCodecRegistry,
    private readonly fieldCodecs: FieldCodecRegistry,
    private readonly limits: ServiceLimits,
    private readonly allowPartial: boolean,
  ) {
    profiles.freeze();
    codecs.freeze();
    fieldCodecs.freeze();
  }

  public pack(input: PackHostMessageInput): HostMessagePackResult {
    const resolved = this.profiles.get(input.reference);
    if (!resolved) return { status: "failed", error: this.missingDefinition(input.reference) };
    const codec = this.codecs.get(resolved.profile.codecId);
    if (!codec) return { status: "failed", error: this.missingCodec(input.reference) };
    try {
      return codec.pack({ resolved, reference: input.reference, fields: input.fields, fieldCodecs: this.fieldCodecs, limits: this.limits });
    } catch (error) {
      if (codec.builtIn) throw error;
      return { status: "failed", error: hostMessageFailure("hostMessage.codec.failed", "Message codec failed", referenceDetails(input.reference)) };
    }
  }

  public unpack(input: UnpackHostMessageInput): HostMessageDecodeResult {
    const resolved = this.profiles.get(input.reference);
    if (!resolved) return { status: "failed", error: this.missingDefinition(input.reference) };
    if (input.bytes.length > resolved.profile.maxMessageBytes || input.bytes.length > this.limits.maxMessageBytes) {
      return { status: "failed", error: hostMessageFailure("hostMessage.limit.exceeded", "Message exceeds its wire limit", {
        ...referenceDetails(input.reference), actual: input.bytes.length, limit: Math.min(resolved.profile.maxMessageBytes, this.limits.maxMessageBytes),
      }) };
    }
    const codec = this.codecs.get(resolved.profile.codecId);
    if (!codec) return { status: "failed", error: this.missingCodec(input.reference) };
    try {
      return codec.unpack({
        resolved,
        reference: input.reference,
        bytes: input.bytes,
        allowPartial: input.allowPartial ?? this.allowPartial,
        fieldCodecs: this.fieldCodecs,
        limits: this.limits,
      });
    } catch (error) {
      if (codec.builtIn) throw error;
      return { status: "failed", error: hostMessageFailure("hostMessage.codec.failed", "Message codec failed", referenceDetails(input.reference)) };
    }
  }

  public safeSummary(message: UnpackedHostMessage): SafeHostMessageSummary {
    const resolved = this.profiles.get(message.reference);
    if (!resolved) {
      throw new FrameworkError({
        category: "configuration",
        code: "hostMessage.profile.missing",
        message: "Cannot summarize an unknown message definition",
        metadata: referenceDetails(message.reference),
      });
    }
    return createSafeSummary(message, resolved.fieldsById);
  }

  private missingDefinition(reference: PackHostMessageInput["reference"]): HostMessageFailure {
    return hostMessageFailure("hostMessage.profile.messageMissing", "Host message definition is unavailable", referenceDetails(reference));
  }

  private missingCodec(reference: PackHostMessageInput["reference"]): HostMessageFailure {
    return hostMessageFailure("hostMessage.codec.missing", "Host message codec is unavailable", referenceDetails(reference));
  }
}

export const createHostMessageService = (options: CreateHostMessageServiceOptions): HostMessageRuntime => {
  const limits = resolveLimits(options.limits);
  const fieldCodecs = new FieldCodecRegistry();
  for (const codec of options.fieldCodecs ?? []) fieldCodecs.register(codec);
  const codecs = new HostMessageCodecRegistry();
  codecs.register(new FixedFieldMessageCodec());
  codecs.register(new Iso8583MessageCodec());
  for (const codec of options.messageCodecs ?? []) codecs.register(codec);
  const profiles = new HostMessageProfileRegistry(codecs, fieldCodecs, limits);
  for (const profile of options.profiles) profiles.register(profile);
  const service = new DefaultHostMessageService(profiles, codecs, fieldCodecs, limits, options.allowPartial ?? false);
  return { codecs, fieldCodecs, profiles, service };
};

const resolveLimits = (input: Partial<ServiceLimits> | undefined): ServiceLimits => {
  const limits = { ...DEFAULT_SERVICE_LIMITS, ...input };
  if (
    limits.maxMessageBytes <= 0 || limits.maxMessageBytes > ABSOLUTE_MAX_MESSAGE_BYTES ||
    limits.maxFixedFields <= 0 || limits.maxRepeatItems <= 0 ||
    limits.maxRepeatDepth < 0 || limits.maxRepeatDepth > 1
  ) {
    throw new FrameworkError({
      category: "configuration",
      code: "hostMessage.limit.invalid",
      message: "Host Message Service limits are invalid",
    });
  }
  return Object.freeze(limits);
};
