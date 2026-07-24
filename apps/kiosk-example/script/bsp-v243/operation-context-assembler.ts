import { bspWithdrawalIciLayout } from "./withdrawal-profile";
import type {
  BspV243AtmRequestHeader,
  BspV243IciFields,
} from "./withdrawal-contracts";
import { BspCredentialMapperRegistry } from "./credential-mapper-registry";
import {
  BspOperationContextError,
  type BspOperationContextInput,
  type BspOperationContextResult,
  type BspOperationClockPort,
  type BspOperationSequencePort,
  type BspRequestSecurityPort,
  type BspTerminalConfiguration,
} from "./operation-context-contracts";

export interface BspV243OperationContextAssemblerOptions {
  readonly amountMultiplier?: number;
  readonly clock: BspOperationClockPort;
  readonly credentialMappers: BspCredentialMapperRegistry;
  readonly pinAuthenticationKey?: string;
  readonly security: BspRequestSecurityPort;
  readonly sequence: BspOperationSequencePort;
  readonly terminal: BspTerminalConfiguration;
}

export class BspV243OperationContextAssembler {
  readonly #amountMultiplier: number;
  readonly #clock: BspOperationClockPort;
  readonly #credentialMappers: BspCredentialMapperRegistry;
  readonly #pinAuthenticationKey: string;
  readonly #security: BspRequestSecurityPort;
  readonly #sequence: BspOperationSequencePort;
  readonly #terminal: BspTerminalConfiguration;

  constructor(options: BspV243OperationContextAssemblerOptions) {
    this.#amountMultiplier = options.amountMultiplier ?? 1;
    this.#clock = options.clock;
    this.#credentialMappers = options.credentialMappers;
    this.#pinAuthenticationKey =
      options.pinAuthenticationKey ?? "pin.online";
    this.#security = options.security;
    this.#sequence = options.sequence;
    this.#terminal = validateTerminal(options.terminal);
  }

  async assemble(
    input: BspOperationContextInput,
  ): Promise<BspOperationContextResult> {
    const credential = input.materials.credential;
    if (credential === undefined) {
      throw fieldError(
        "BSP_CREDENTIAL_INVALID",
        "Operation credential is missing",
        "credential",
      );
    }
    if (credential.entryMethodId !== input.assessment.entryMethodId) {
      throw fieldError(
        "BSP_CREDENTIAL_INVALID",
        "Credential entry method does not match its assessment",
        "entryMethodId",
      );
    }

    const mapper = this.#credentialMappers.require(
      input.assessment.entryMethodId,
    );
    const [dates, sequence, projection] = await Promise.all([
      this.#clock.currentDates(input.operationId),
      this.#sequence.next(input.operationId),
      mapper.map({
        entryMethodId: credential.entryMethodId,
        material: credential.material,
        operationId: input.operationId,
      }),
    ]);
    validateDates(dates);

    const header = createHeader(
      this.#terminal,
      dates.businessDate,
      dates.systemDate,
      sequence,
    );
    const ici = {
      ...createDefaultIci(),
      ...projection.ici,
      inAtmBusinessDay: dates.businessDate.slice(-2),
      inCurrencyCode: this.#terminal.currencyCode,
      inMacDate: dates.macDate,
      inTransactionAmount: formatAmount(
        input.amount,
        this.#amountMultiplier,
      ),
    };

    if (mapper.requiresPin) {
      ici.inPinBlock = requirePinBlock(
        input.materials.authentication[this.#pinAuthenticationKey],
      );
    }
    for (const fieldId of mapper.requiredFields ?? []) {
      requirePopulatedField(ici, fieldId);
    }

    const security = await this.#security.protect({
      header,
      ici,
      mapperId: mapper.id,
      operationId: input.operationId,
    });
    ici.inTerminalCheck = requireExactText(
      security.terminalCheck,
      8,
      "inTerminalCheck",
      "BSP_SECURITY_RESULT_INVALID",
    );
    ici.inMac = requireExactText(
      security.mac,
      8,
      "inMac",
      "BSP_SECURITY_RESULT_INVALID",
    );

    return {
      bspContext: { header, ici },
      entryMode: mapper.entryMode,
      safeMetadata: {
        credentialEntryMethodId: input.assessment.entryMethodId,
        credentialMapperId: mapper.id,
        credentialMapperVersion: mapper.version,
      },
    };
  }
}

function createDefaultIci(): BspV243IciFields {
  return Object.fromEntries(
    bspWithdrawalIciLayout.map((field) => [
      field.id,
      "numeric" in field && field.numeric === true
        ? "0".repeat(field.bytes)
        : "",
    ]),
  ) as BspV243IciFields;
}

function createHeader(
  terminal: BspTerminalConfiguration,
  businessDate: string,
  systemDate: string,
  sequence: number | string,
): BspV243AtmRequestHeader {
  return {
    atmId: terminal.atmId,
    businessDate,
    depositMode: terminal.depositMode,
    deviceStatus: terminal.deviceStatus,
    mode: terminal.mode,
    notesFiveToEight: terminal.notesFiveToEight,
    sequence: formatSequence(sequence),
    serviceStatus: terminal.serviceStatus,
    systemDate,
    transmissionArea: terminal.transmissionArea,
    versionDate: terminal.versionDate,
    versionMarker: terminal.versionMarker,
  };
}

function validateTerminal(
  terminal: BspTerminalConfiguration,
): BspTerminalConfiguration {
  requireExactText(
    terminal.atmId,
    5,
    "atmId",
    "BSP_CONFIGURATION_INVALID",
  );
  requireNumeric(
    terminal.versionDate,
    8,
    "versionDate",
    "BSP_CONFIGURATION_INVALID",
  );
  requireExactText(
    terminal.versionMarker,
    1,
    "versionMarker",
    "BSP_CONFIGURATION_INVALID",
  );
  requireNumeric(
    terminal.currencyCode,
    2,
    "currencyCode",
    "BSP_CONFIGURATION_INVALID",
  );
  validateOptionalWidth(terminal.transmissionArea, 2, "transmissionArea");
  validateOptionalWidth(terminal.deviceStatus, 12, "deviceStatus");
  validateOptionalWidth(terminal.serviceStatus, 1, "serviceStatus");
  validateOptionalWidth(terminal.mode, 1, "mode");
  validateOptionalWidth(terminal.depositMode, 1, "depositMode");
  validateOptionalWidth(terminal.notesFiveToEight, 4, "notesFiveToEight");
  return terminal;
}

function validateOptionalWidth(
  value: string | undefined,
  width: number,
  fieldId: string,
): void {
  if (value !== undefined) {
    requireExactText(value, width, fieldId, "BSP_CONFIGURATION_INVALID");
  }
}

function validateDates(
  dates: {
    readonly businessDate: string;
    readonly macDate: string;
    readonly systemDate: string;
  },
): void {
  requireNumeric(dates.businessDate, 8, "businessDate", "BSP_DATE_INVALID");
  requireNumeric(dates.systemDate, 8, "systemDate", "BSP_DATE_INVALID");
  requireNumeric(dates.macDate, 6, "macDate", "BSP_DATE_INVALID");
}

function formatSequence(value: number | string): string {
  const text =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : value;
  if (typeof text !== "string" || !/^\d{1,8}$/u.test(text)) {
    throw fieldError(
      "BSP_SEQUENCE_INVALID",
      "BSP sequence must be an unsigned value of at most eight digits",
      "sequence",
    );
  }
  return text.padStart(8, "0");
}

function formatAmount(amount: number, multiplier: number): string {
  const wireAmount = amount * multiplier;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    !Number.isSafeInteger(wireAmount) ||
    wireAmount > 99_999_999
  ) {
    throw fieldError(
      "BSP_AMOUNT_INVALID",
      "BSP amount cannot be represented as an eight-digit integer",
      "inTransactionAmount",
    );
  }
  return String(wireAmount).padStart(8, "0");
}

function requirePinBlock(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "securePin" ||
    !("encryptedPinBlock" in value) ||
    typeof value.encryptedPinBlock !== "string" ||
    !/^[0-9A-Fa-f]{16}$/u.test(value.encryptedPinBlock)
  ) {
    throw fieldError(
      "BSP_PIN_REQUIRED",
      "A 16-character secure PIN block is required",
      "inPinBlock",
    );
  }
  return value.encryptedPinBlock.toUpperCase();
}

function requirePopulatedField(
  ici: BspV243IciFields,
  fieldId: keyof BspV243IciFields,
): void {
  const value = ici[fieldId];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw fieldError(
      "BSP_FIELD_INVALID",
      `Required BSP field '${String(fieldId)}' is missing`,
      String(fieldId),
    );
  }
}

function requireNumeric(
  value: string,
  width: number,
  fieldId: string,
  code:
    | "BSP_CONFIGURATION_INVALID"
    | "BSP_DATE_INVALID",
): string {
  if (!new RegExp(`^\\d{${width}}$`, "u").test(value)) {
    throw fieldError(
      code,
      `${fieldId} must contain exactly ${width} digits`,
      fieldId,
    );
  }
  return value;
}

function requireExactText(
  value: string,
  width: number,
  fieldId: string,
  code:
    | "BSP_CONFIGURATION_INVALID"
    | "BSP_SECURITY_RESULT_INVALID",
): string {
  if (
    typeof value !== "string" ||
    value.length !== width ||
    !/^[\x20-\x7E]+$/u.test(value)
  ) {
    throw fieldError(
      code,
      `${fieldId} must contain exactly ${width} printable ASCII characters`,
      fieldId,
    );
  }
  return value;
}

function fieldError(
  code: ConstructorParameters<typeof BspOperationContextError>[0],
  message: string,
  fieldId: string,
): BspOperationContextError {
  return new BspOperationContextError(code, message, fieldId);
}
