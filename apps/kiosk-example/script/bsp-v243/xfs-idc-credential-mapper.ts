import {
  BspOperationContextError,
  type BspCredentialMapper,
  type BspCredentialMapperInput,
  type BspCredentialProjection,
} from "./operation-context-contracts";

interface XfsCardDataRecord {
  readonly data: Uint8Array;
  readonly dataSource: number;
}

export interface DecodedXfsIdcCard {
  has(source: number): boolean;
  requireBytes(source: number): Uint8Array;
  requireText(source: number): string;
}

export interface BspXfsIdcCredentialMapperOptions {
  readonly entryMethodIds: readonly string[];
  readonly id: string;
  readonly okStatus?: number;
  readonly requiredSources?: readonly number[];
  readonly requiredFields?: BspCredentialMapper["requiredFields"];
  readonly resolve: (
    card: DecodedXfsIdcCard,
    input: BspCredentialMapperInput,
  ) => BspCredentialProjection | Promise<BspCredentialProjection>;
  readonly version: string;
}

class DecodedXfsIdcCardValue implements DecodedXfsIdcCard {
  readonly #records: ReadonlyMap<number, Uint8Array>;

  constructor(records: readonly XfsCardDataRecord[]) {
    this.#records = new Map(
      records.map((record) => [record.dataSource, record.data]),
    );
  }

  has(source: number): boolean {
    return this.#records.has(source);
  }

  requireBytes(source: number): Uint8Array {
    const data = this.#records.get(source);
    if (data === undefined) {
      throw new BspOperationContextError(
        "BSP_CREDENTIAL_INVALID",
        `Required IDC data source '${source}' is unavailable`,
        `idc.source.${source}`,
      );
    }
    return data.slice();
  }

  requireText(source: number): string {
    const text = new TextDecoder("ascii").decode(this.requireBytes(source));
    return text.replace(/\0+$/u, "");
  }
}

export function createBspXfsIdcCredentialMapper(
  options: BspXfsIdcCredentialMapperOptions,
): BspCredentialMapper {
  return {
    entryMethodIds: options.entryMethodIds,
    entryMode: "contact-card",
    id: options.id,
    requiredFields: options.requiredFields ?? [
      "inBankNumber",
      "inCardAccount",
      "inTransactionAccount",
      "inTrack3",
    ],
    requiresPin: true,
    version: options.version,
    async map(input) {
      const card = decodeXfsIdcCard(input.material, options.okStatus ?? 0);
      for (const source of options.requiredSources ?? []) {
        card.requireBytes(source);
      }
      return options.resolve(card, input);
    },
  };
}

function decodeXfsIdcCard(
  material: unknown,
  okStatus: number,
): DecodedXfsIdcCard {
  const cardResult = requireRecord(material, "card material");
  if (cardResult.kind !== "card") {
    throw invalidCredential("Credential material is not an IDC card result");
  }

  const raw = requireRecord(cardResult.raw, "IDC raw result");
  if (!Array.isArray(raw.cardData)) {
    throw invalidCredential("IDC raw result has no card data");
  }

  const records: XfsCardDataRecord[] = [];
  for (const value of raw.cardData) {
    const record = requireRecord(value, "IDC card data");
    if (record.status !== okStatus) {
      continue;
    }
    if (typeof record.dataSource !== "number") {
      throw invalidCredential("IDC data source is invalid");
    }
    records.push({
      data: requireBytes(record.data),
      dataSource: record.dataSource,
    });
  }

  if (records.length === 0) {
    throw invalidCredential("IDC result contains no successful card data");
  }
  return new DecodedXfsIdcCardValue(records);
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidCredential(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function requireBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  ) {
    return Uint8Array.from(value as number[]);
  }
  throw invalidCredential("IDC card data bytes are invalid");
}

function invalidCredential(message: string): BspOperationContextError {
  return new BspOperationContextError(
    "BSP_CREDENTIAL_INVALID",
    message,
    "credential",
  );
}
