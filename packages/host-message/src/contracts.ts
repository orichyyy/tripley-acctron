import type { Result } from "@tripley-kit/web-container-types";

export type DataClassification = "public" | "internal" | "sensitive" | "secret";
export type MessageDirection = "request" | "response" | "advice";
export type FieldPresence = "required" | "optional" | "optionalTrailing" | "forbidden";
export type LengthEncoding = "ascii" | "bcd";
export type LengthUnit = "bytes" | "digits";

export type HostFieldValue = string | Uint8Array | readonly HostFieldSet[];

export interface HostFieldSet {
  readonly [fieldId: string]: HostFieldValue;
}

export interface HostMessageReference {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly messageId: string;
}

export type FieldEncoding =
  | { readonly kind: "ascii" }
  | { readonly kind: "utf8" }
  | { readonly kind: "binary" }
  | { readonly kind: "ascii-hex" }
  | {
      readonly kind: "bcd";
      readonly digitCount?: number;
      readonly padDirection?: "left" | "right";
      readonly padNibble?: number;
    }
  | { readonly kind: "custom"; readonly codecId: string; readonly codecVersion: string };

export type FieldLength =
  | { readonly kind: "fixed"; readonly bytes: number }
  | {
      readonly kind: "llvar" | "lllvar";
      readonly maxLength: number;
      readonly lengthEncoding: LengthEncoding;
      readonly lengthUnit?: LengthUnit;
    };

export interface FieldPadding {
  readonly byte: number;
  readonly direction: "left" | "right";
  readonly stripOnDecode?: boolean;
}

export interface FieldValidation {
  readonly allowedValues?: readonly string[];
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly pattern?: string;
}

export type SafeSummaryPolicy =
  | { readonly mode: "omit" | "presence" }
  | { readonly mode: "value" }
  | { readonly mode: "masked"; readonly showFirst?: number; readonly showLast?: number };

export interface HostFieldDefinition {
  readonly id: string;
  readonly dataClassification: DataClassification;
  readonly dataElement?: number;
  readonly encoding: FieldEncoding;
  readonly length: FieldLength;
  readonly allowBlank?: boolean;
  readonly padding?: FieldPadding;
  readonly safeSummary?: SafeSummaryPolicy;
  readonly validation?: FieldValidation;
}

export interface ScalarFieldUse {
  readonly kind: "field";
  readonly fieldId: string;
  readonly presence?: FieldPresence;
}

export interface RepeatingGroupUse {
  readonly kind: "repeatingGroup";
  readonly id: string;
  readonly countFieldId: string;
  readonly itemFieldIds: readonly string[];
  readonly maxItems: number;
  readonly fixedAreaBytes?: number;
  readonly padByte?: number;
  readonly presence?: "required" | "optionalTrailing";
}

export type HostMessageFieldUse = ScalarFieldUse | RepeatingGroupUse;

export interface HostMessageDefinition {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly fields: readonly HostMessageFieldUse[];
  readonly bitmapEncoding?: "binary" | "ascii-hex";
  readonly mti?: string;
  readonly mtiEncoding?: "ascii" | "bcd";
}

export interface HostMessageProfile {
  readonly id: string;
  readonly version: string;
  readonly codecId: string;
  readonly maxMessageBytes: number;
  readonly fieldDefinitions: readonly HostFieldDefinition[];
  readonly messages: readonly HostMessageDefinition[];
}

export interface ServiceLimits {
  readonly maxMessageBytes: number;
  readonly maxFixedFields: number;
  readonly maxRepeatItems: number;
  readonly maxRepeatDepth: number;
}

export interface HostMessageFailure {
  readonly category: "protocol";
  readonly code: string;
  readonly message: string;
  readonly profileId?: string;
  readonly profileVersion?: string;
  readonly messageId?: string;
  readonly fieldId?: string;
  readonly dataElement?: number;
  readonly fieldIndex?: number;
  readonly groupId?: string;
  readonly itemIndex?: number;
  readonly itemFieldId?: string;
  readonly byteOffset?: number;
  readonly expectedBytes?: number;
  readonly receivedBytes?: number;
  readonly phase?: string;
  readonly limit?: number;
  readonly actual?: number;
}

export type PartialDecodeFailure = HostMessageFailure;

export interface PackedHostMessage {
  readonly reference: HostMessageReference;
  readonly bytes: Uint8Array;
}

export interface UnpackedHostMessage {
  readonly reference: HostMessageReference;
  readonly fields: HostFieldSet;
  readonly wireLength: number;
}

export type HostMessagePackResult =
  | { readonly status: "packed"; readonly message: PackedHostMessage }
  | { readonly status: "failed"; readonly error: HostMessageFailure };

export type HostMessageDecodeResult =
  | { readonly status: "complete"; readonly message: UnpackedHostMessage }
  | {
      readonly status: "partial";
      readonly reference: HostMessageReference;
      readonly fields: HostFieldSet;
      readonly failure: PartialDecodeFailure;
      readonly consumedBytes: number;
      readonly receivedBytes: number;
    }
  | { readonly status: "failed"; readonly error: HostMessageFailure };

export interface PackHostMessageInput {
  readonly reference: HostMessageReference;
  readonly fields: HostFieldSet;
}

export interface UnpackHostMessageInput {
  readonly reference: HostMessageReference;
  readonly bytes: Uint8Array;
  readonly allowPartial?: boolean;
}

export interface SafeHostMessageSummary {
  readonly reference: HostMessageReference;
  readonly wireLength: number;
  readonly fields: Readonly<Record<string, string | number | boolean>>;
}

export interface FieldCodecContext {
  readonly field: HostFieldDefinition;
  readonly logicalLength?: number;
}

export interface EncodedFieldValue {
  readonly bytes: Uint8Array;
  readonly logicalLength: number;
}

export interface FieldCodec {
  readonly id: string;
  readonly version: string;
  encode(
    value: string | Uint8Array,
    context: FieldCodecContext,
  ): Result<EncodedFieldValue, HostMessageFailure>;
  decode(
    bytes: Uint8Array,
    context: FieldCodecContext,
  ): Result<string | Uint8Array, HostMessageFailure>;
}

export interface FieldCodecLookup {
  get(id: string, version: string): FieldCodec | undefined;
}

export interface ResolvedHostMessageDefinition {
  readonly profile: HostMessageProfile;
  readonly message: HostMessageDefinition;
  readonly fieldsById: ReadonlyMap<string, HostFieldDefinition>;
}

export interface HostMessageCodecPackContext {
  readonly resolved: ResolvedHostMessageDefinition;
  readonly reference: HostMessageReference;
  readonly fields: HostFieldSet;
  readonly fieldCodecs: FieldCodecLookup;
  readonly limits: ServiceLimits;
}

export interface HostMessageCodecUnpackContext {
  readonly resolved: ResolvedHostMessageDefinition;
  readonly reference: HostMessageReference;
  readonly bytes: Uint8Array;
  readonly allowPartial: boolean;
  readonly fieldCodecs: FieldCodecLookup;
  readonly limits: ServiceLimits;
}

export interface HostMessageCodec {
  readonly id: string;
  readonly builtIn?: boolean;
  pack(context: HostMessageCodecPackContext): HostMessagePackResult;
  unpack(context: HostMessageCodecUnpackContext): HostMessageDecodeResult;
}

export interface HostMessageService {
  pack(input: PackHostMessageInput): HostMessagePackResult;
  unpack(input: UnpackHostMessageInput): HostMessageDecodeResult;
  safeSummary(message: UnpackedHostMessage): SafeHostMessageSummary;
}
