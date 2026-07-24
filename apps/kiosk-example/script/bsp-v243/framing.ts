import type {
  HostFrameCodec,
  HostFrameDecodeResult,
} from "@tripley-kit/web-container-kiosk-host-native-channel";

const HEADER_BYTES = 12;
const FIXED_HEADER = Uint8Array.of(0x0f, 0x0f, 0x0f);
const CONTROL_MARKER = 0x01;
const TRAILER_MARKER = 0x0f;
const textEncoder = new TextEncoder();

export interface BspV243FrameCodecOptions {
  readonly initialCounter?: number | undefined;
  readonly maxFrameBytes?: number | undefined;
}

export const createBspV243FrameCodec = (
  options: BspV243FrameCodecOptions = {},
): HostFrameCodec => {
  const maxFrameBytes = options.maxFrameBytes ?? 2_048;
  let counter = validateOptions(options.initialCounter ?? 0, maxFrameBytes);
  return {
    encode: (payload) => {
      const frame = encodeFrame(payload, counter, maxFrameBytes);
      counter = (counter + 1) % 1_000;
      return frame;
    },
    decode: (bytes) => decodeFrame(bytes, maxFrameBytes),
  };
};

const encodeFrame = (
  payload: Uint8Array,
  counter: number,
  maxFrameBytes: number,
): Uint8Array => {
  const totalBytes = HEADER_BYTES + payload.length;
  if (totalBytes > maxFrameBytes || totalBytes > 999_999) {
    throw new Error("bsp.v243.frame-too-large");
  }
  const frame = new Uint8Array(totalBytes);
  frame.set(FIXED_HEADER, 0);
  frame.set(encodeBcdLength(totalBytes), 3);
  frame[6] = CONTROL_MARKER;
  frame.set(textEncoder.encode(String(counter).padStart(3, "0")), 7);
  frame[10] = TRAILER_MARKER;
  frame[11] = TRAILER_MARKER;
  frame.set(payload, HEADER_BYTES);
  return frame;
};

const decodeFrame = (
  bytes: Uint8Array,
  maxFrameBytes: number,
): HostFrameDecodeResult => {
  if (bytes.length < HEADER_BYTES) return { status: "incomplete" };
  if (!startsWith(bytes, FIXED_HEADER)) {
    return { errorCode: "bsp.v243.frame-header-1-invalid", status: "invalid" };
  }
  const totalBytes = decodeBcdLength(bytes.slice(3, 6));
  if (totalBytes === undefined) {
    return { errorCode: "bsp.v243.frame-header-2-invalid", status: "invalid" };
  }
  if (totalBytes < HEADER_BYTES || totalBytes > maxFrameBytes) {
    return { errorCode: "bsp.v243.frame-length-invalid", status: "invalid" };
  }
  if (bytes[6] !== CONTROL_MARKER) {
    return { errorCode: "bsp.v243.frame-header-3-invalid", status: "invalid" };
  }
  if (!isAsciiCounter(bytes.slice(7, 10))) {
    return { errorCode: "bsp.v243.frame-header-4-invalid", status: "invalid" };
  }
  if (bytes[10] !== TRAILER_MARKER || bytes[11] !== TRAILER_MARKER) {
    return { errorCode: "bsp.v243.frame-header-5-6-invalid", status: "invalid" };
  }
  if (bytes.length < totalBytes) return { status: "incomplete" };
  return {
    consumedBytes: totalBytes,
    payload: bytes.slice(HEADER_BYTES, totalBytes),
    status: "complete",
  };
};

const validateOptions = (counter: number, maxFrameBytes: number): number => {
  if (
    !Number.isInteger(counter) ||
    counter < 0 ||
    counter > 999 ||
    !Number.isInteger(maxFrameBytes) ||
    maxFrameBytes <= HEADER_BYTES
  ) {
    throw new Error("bsp.v243.frame-config-invalid");
  }
  return counter;
};

const encodeBcdLength = (value: number): Uint8Array => {
  const digits = String(value).padStart(6, "0");
  return Uint8Array.from(
    { length: 3 },
    (_, index) => Number(digits[index * 2]) * 16 + Number(digits[index * 2 + 1]),
  );
};

const decodeBcdLength = (bytes: Uint8Array): number | undefined => {
  let value = 0;
  for (const byte of bytes) {
    const high = byte >> 4;
    const low = byte & 0x0f;
    if (high > 9 || low > 9) return undefined;
    value = value * 100 + high * 10 + low;
  }
  return value;
};

const isAsciiCounter = (bytes: Uint8Array): boolean =>
  bytes.length === 3 && bytes.every((byte) => byte >= 0x30 && byte <= 0x39);

const startsWith = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  prefix.every((byte, index) => bytes[index] === byte);
