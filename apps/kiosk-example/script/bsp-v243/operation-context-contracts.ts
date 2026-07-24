import type {
  BspV243AtmRequestHeader,
  BspV243IciFields,
  BspV243IwdContext,
} from "./withdrawal-contracts";

export type BspWithdrawalEntryMode =
  | "contact-card"
  | "cardless-reservation";

export interface BspOperationCredential {
  readonly entryMethodId: string;
  readonly material: unknown;
  readonly operationId?: string;
}

export interface BspOperationMaterials {
  readonly credential?: BspOperationCredential;
  readonly authentication: Readonly<Record<string, unknown>>;
}

export interface BspOperationContextInput {
  readonly amount: number;
  readonly assessment: {
    readonly entryMethodId: string;
  };
  readonly materials: BspOperationMaterials;
  readonly operationId: string;
}

export interface BspCredentialMapperInput {
  readonly entryMethodId: string;
  readonly material: unknown;
  readonly operationId: string;
}

export interface BspCredentialProjection {
  readonly ici: Readonly<Partial<BspV243IciFields>>;
}

export interface BspCredentialMapper {
  readonly id: string;
  readonly version: string;
  readonly entryMethodIds: readonly string[];
  readonly entryMode: BspWithdrawalEntryMode;
  readonly requiresPin: boolean;
  readonly requiredFields?: readonly (keyof BspV243IciFields)[];
  map(
    input: BspCredentialMapperInput,
  ): BspCredentialProjection | Promise<BspCredentialProjection>;
}

export interface BspOperationDates {
  readonly businessDate: string;
  readonly macDate: string;
  readonly systemDate: string;
}

export interface BspOperationClockPort {
  currentDates(
    operationId: string,
  ): BspOperationDates | Promise<BspOperationDates>;
}

export interface BspOperationSequencePort {
  next(operationId: string): number | string | Promise<number | string>;
}

export interface BspTerminalConfiguration {
  readonly atmId: string;
  readonly currencyCode: string;
  readonly depositMode?: string;
  readonly deviceStatus?: string;
  readonly mode?: string;
  readonly notesFiveToEight?: string;
  readonly serviceStatus?: string;
  readonly transmissionArea?: string;
  readonly versionDate: string;
  readonly versionMarker: string;
}

export interface BspRequestSecurityInput {
  readonly header: BspV243AtmRequestHeader;
  readonly ici: Readonly<BspV243IciFields>;
  readonly mapperId: string;
  readonly operationId: string;
}

export interface BspRequestSecurityResult {
  readonly mac: string;
  readonly terminalCheck: string;
}

export interface BspRequestSecurityPort {
  protect(
    input: BspRequestSecurityInput,
  ): BspRequestSecurityResult | Promise<BspRequestSecurityResult>;
}

export interface BspOperationContextResult {
  readonly bspContext: BspV243IwdContext;
  readonly entryMode: BspWithdrawalEntryMode;
  readonly safeMetadata: Readonly<Record<string, string>>;
}

export type BspOperationContextErrorCode =
  | "BSP_AMOUNT_INVALID"
  | "BSP_CONFIGURATION_INVALID"
  | "BSP_CREDENTIAL_INVALID"
  | "BSP_CREDENTIAL_MAPPER_DUPLICATE"
  | "BSP_CREDENTIAL_MAPPER_MISSING"
  | "BSP_DATE_INVALID"
  | "BSP_FIELD_INVALID"
  | "BSP_PIN_REQUIRED"
  | "BSP_SECURITY_RESULT_INVALID"
  | "BSP_SEQUENCE_INVALID";

export class BspOperationContextError extends Error {
  readonly code: BspOperationContextErrorCode;
  readonly fieldId: string | undefined;

  constructor(
    code: BspOperationContextErrorCode,
    message: string,
    fieldId?: string,
  ) {
    super(message);
    this.name = "BspOperationContextError";
    this.code = code;
    this.fieldId = fieldId;
  }

  toJSON(): Readonly<Record<string, string>> {
    return {
      code: this.code,
      ...(this.fieldId === undefined ? {} : { fieldId: this.fieldId }),
      name: this.name,
    };
  }
}
