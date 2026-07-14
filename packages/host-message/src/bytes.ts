import type { HostMessageFailure, LengthEncoding } from "./contracts";
import { hostMessageFailure } from "./failures";

export class ByteCursor {
  private position = 0;

  public constructor(private readonly source: Uint8Array) {}

  public get offset(): number {
    return this.position;
  }

  public get remaining(): number {
    return this.source.length - this.position;
  }

  public read(length: number): Uint8Array | undefined {
    if (length < 0 || length > this.remaining) {
      return undefined;
    }
    const value = this.source.slice(this.position, this.position + length);
    this.position += length;
    return value;
  }
}

export const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

export const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();

export const hexToBytes = (value: string): Uint8Array | undefined => {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    return undefined;
  }
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
};

export const encodeDecimalLength = (
  value: number,
  width: number,
  encoding: LengthEncoding,
): Uint8Array | HostMessageFailure => {
  const digits = String(value).padStart(width, "0");
  if (digits.length > width) {
    return hostMessageFailure("hostMessage.limit.exceeded", "Field length exceeds prefix capacity", {
      actual: value,
      limit: 10 ** width - 1,
      phase: "lengthPrefix",
    });
  }
  if (encoding === "ascii") {
    return Uint8Array.from([...digits].map((character) => character.charCodeAt(0)));
  }
  const padded = digits.length % 2 === 0 ? digits : `0${digits}`;
  const bytes = new Uint8Array(padded.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const decodeDecimalLength = (
  bytes: Uint8Array,
  width: number,
  encoding: LengthEncoding,
): number | HostMessageFailure => {
  let digits = "";
  if (encoding === "ascii") {
    digits = String.fromCharCode(...bytes);
  } else {
    digits = bytesToHex(bytes).slice(-width);
  }
  if (!/^\d+$/.test(digits)) {
    return hostMessageFailure(
      "hostMessage.field.invalidLengthPrefix",
      "Field length prefix is invalid",
      { phase: "lengthPrefix" },
    );
  }
  return Number.parseInt(digits, 10);
};
