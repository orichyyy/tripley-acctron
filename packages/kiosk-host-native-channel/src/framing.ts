export type HostFrameDecodeResult =
  | { readonly status: "incomplete" }
  | { readonly status: "complete"; readonly payload: Uint8Array; readonly consumedBytes: number }
  | { readonly status: "invalid"; readonly errorCode: string };

export interface HostFrameCodec {
  encode(payload: Uint8Array): Uint8Array;
  decode(bytes: Uint8Array): HostFrameDecodeResult;
}

export interface LengthPrefixFrameOptions {
  readonly fixedHeader?: Uint8Array | undefined;
  readonly lengthBytes: number;
  readonly lengthEncoding: "ascii" | "bcd";
  readonly lengthIncludesFixedHeader?: boolean | undefined;
  readonly lengthIncludesLengthField: boolean;
  readonly maxFrameBytes: number;
}

export interface AsciiLengthPrefixFrameOptions {
  readonly prefixBytes: number;
  readonly lengthIncludesPrefix: boolean;
  readonly maxFrameBytes: number;
}

type NormalizedLengthPrefixFrameOptions = Omit<
  LengthPrefixFrameOptions,
  "fixedHeader" | "lengthIncludesFixedHeader"
> & {
  readonly fixedHeader: Uint8Array;
  readonly lengthIncludesFixedHeader: boolean;
};

export const createAsciiLengthPrefixFrameCodec = (
  options: AsciiLengthPrefixFrameOptions,
): HostFrameCodec =>
  createLengthPrefixFrameCodec({
    lengthBytes: options.prefixBytes,
    lengthEncoding: "ascii",
    lengthIncludesLengthField: options.lengthIncludesPrefix,
    maxFrameBytes: options.maxFrameBytes,
  });

export const createLengthPrefixFrameCodec = (options: LengthPrefixFrameOptions): HostFrameCodec => {
  const normalized = normalizeOptions(options);
  return {
    decode: (bytes) => decodeFrame(bytes, normalized),
    encode: (payload) => encodeFrame(payload, normalized),
  };
};

const encodeFrame = (
  payload: Uint8Array,
  options: NormalizedLengthPrefixFrameOptions,
): Uint8Array => {
  const prefixBytes = options.fixedHeader.length + options.lengthBytes;
  const totalBytes = prefixBytes + payload.length;
  if (totalBytes > options.maxFrameBytes) throw new Error("host.channel.frame-too-large");
  const declaredLength = payload.length + includedOverhead(options);
  const length = encodeLength(declaredLength, options);
  const result = new Uint8Array(totalBytes);
  result.set(options.fixedHeader);
  result.set(length, options.fixedHeader.length);
  result.set(payload, prefixBytes);
  return result;
};

const decodeFrame = (
  bytes: Uint8Array,
  options: NormalizedLengthPrefixFrameOptions,
): HostFrameDecodeResult => {
  const prefixBytes = options.fixedHeader.length + options.lengthBytes;
  if (bytes.length < prefixBytes) return { status: "incomplete" };
  if (!startsWith(bytes, options.fixedHeader)) {
    return { errorCode: "host.channel.frame-header-invalid", status: "invalid" };
  }
  const lengthBytes = bytes.slice(options.fixedHeader.length, prefixBytes);
  const declaredLength = decodeLength(lengthBytes, options.lengthEncoding);
  if (declaredLength === undefined) {
    return { errorCode: "host.channel.frame-prefix-invalid", status: "invalid" };
  }
  const payloadBytes = declaredLength - includedOverhead(options);
  const totalBytes = prefixBytes + payloadBytes;
  if (payloadBytes < 0 || totalBytes > options.maxFrameBytes) {
    return { errorCode: "host.channel.frame-length-invalid", status: "invalid" };
  }
  if (bytes.length < totalBytes) return { status: "incomplete" };
  return {
    consumedBytes: totalBytes,
    payload: bytes.slice(prefixBytes, totalBytes),
    status: "complete",
  };
};

const normalizeOptions = (
  options: LengthPrefixFrameOptions,
): NormalizedLengthPrefixFrameOptions => {
  const fixedHeader = options.fixedHeader?.slice() ?? new Uint8Array();
  const maxLengthBytes = options.lengthEncoding === "ascii" ? 9 : 6;
  if (
    !Number.isInteger(options.lengthBytes) ||
    options.lengthBytes < 1 ||
    options.lengthBytes > maxLengthBytes ||
    !Number.isInteger(options.maxFrameBytes) ||
    options.maxFrameBytes <= fixedHeader.length + options.lengthBytes
  ) {
    throw new Error("host.channel.frame-config-invalid");
  }
  return {
    ...options,
    fixedHeader,
    lengthIncludesFixedHeader: options.lengthIncludesFixedHeader ?? false,
  };
};

const includedOverhead = (options: NormalizedLengthPrefixFrameOptions): number =>
  (options.lengthIncludesFixedHeader ? options.fixedHeader.length : 0) +
  (options.lengthIncludesLengthField ? options.lengthBytes : 0);

const encodeLength = (value: number, options: NormalizedLengthPrefixFrameOptions): Uint8Array => {
  const digits = options.lengthEncoding === "ascii" ? options.lengthBytes : options.lengthBytes * 2;
  const encoded = String(value).padStart(digits, "0");
  if (encoded.length !== digits) throw new Error("host.channel.frame-length-overflow");
  if (options.lengthEncoding === "ascii") return new TextEncoder().encode(encoded);
  return Uint8Array.from(
    { length: options.lengthBytes },
    (_, index) => Number(encoded[index * 2]) * 16 + Number(encoded[index * 2 + 1]),
  );
};

const decodeLength = (
  bytes: Uint8Array,
  encoding: LengthPrefixFrameOptions["lengthEncoding"],
): number | undefined => {
  if (encoding === "ascii") {
    const value = new TextDecoder().decode(bytes);
    return /^\d+$/.test(value) ? Number(value) : undefined;
  }
  let value = 0;
  for (const byte of bytes) {
    const high = byte >> 4;
    const low = byte & 0x0f;
    if (high > 9 || low > 9) return undefined;
    value = value * 100 + high * 10 + low;
  }
  return value;
};

const startsWith = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  prefix.every((byte, index) => bytes[index] === byte);
