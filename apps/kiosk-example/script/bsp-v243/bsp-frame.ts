import {
  type HostFrameCodec,
  type HostFrameDecodeResult,
  createLengthPrefixFrameCodec,
} from "@tripley-kit/web-container-kiosk-host-native-channel";

const FIXED_HEADER = Uint8Array.of(0x0f, 0x0f, 0x0f);
const SHARED_HEADER_SUFFIX_BYTES = 6;
const COUNTER_LIMIT = 1_000;

export const createBspV243FrameCodec = (): HostFrameCodec => {
  const lengthPrefixedFrame = createLengthPrefixFrameCodec({
    fixedHeader: FIXED_HEADER,
    lengthBytes: 3,
    lengthEncoding: "bcd",
    lengthIncludesFixedHeader: true,
    lengthIncludesLengthField: true,
    maxFrameBytes: 2_048,
  });
  let requestCounter = 0;

  return {
    decode: (bytes) => stripSharedHeader(lengthPrefixedFrame.decode(bytes)),
    encode: (payload) => {
      const framed = lengthPrefixedFrame.encode(
        concatenate(createSharedHeaderSuffix(requestCounter), payload),
      );
      requestCounter = (requestCounter + 1) % COUNTER_LIMIT;
      return framed;
    },
  };
};

const createSharedHeaderSuffix = (counter: number): Uint8Array => {
  const suffix = new Uint8Array(SHARED_HEADER_SUFFIX_BYTES);
  suffix[0] = 0x01;
  suffix.set(new TextEncoder().encode(String(counter).padStart(3, "0")), 1);
  suffix[4] = 0x0f;
  suffix[5] = 0x0f;
  return suffix;
};

const stripSharedHeader = (decoded: HostFrameDecodeResult): HostFrameDecodeResult => {
  if (decoded.status !== "complete") return decoded;
  if (!hasValidSharedHeaderSuffix(decoded.payload)) {
    return { errorCode: "bsp.v243.frame-header-invalid", status: "invalid" };
  }
  return {
    ...decoded,
    payload: decoded.payload.slice(SHARED_HEADER_SUFFIX_BYTES),
  };
};

const hasValidSharedHeaderSuffix = (payload: Uint8Array): boolean =>
  payload.length >= SHARED_HEADER_SUFFIX_BYTES &&
  payload[0] === 0x01 &&
  isAsciiDigit(payload[1]) &&
  isAsciiDigit(payload[2]) &&
  isAsciiDigit(payload[3]) &&
  payload[4] === 0x0f &&
  payload[5] === 0x0f;

const isAsciiDigit = (value: number | undefined): boolean =>
  value !== undefined && value >= 0x30 && value <= 0x39;

const concatenate = (first: Uint8Array, second: Uint8Array): Uint8Array => {
  const result = new Uint8Array(first.length + second.length);
  result.set(first);
  result.set(second, first.length);
  return result;
};
