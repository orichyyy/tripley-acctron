import { KioskError, type HostCodec } from "@tripley-acctron/contracts";

export class JsonHostCodec<RawMessage = unknown> implements HostCodec<RawMessage> {
  public encode(message: RawMessage): string {
    return JSON.stringify(message);
  }

  public decode(data: Uint8Array | string): RawMessage {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    try {
      return JSON.parse(text) as RawMessage;
    } catch (error) {
      throw new KioskError("host.codec", "Failed to decode host JSON message.", error);
    }
  }
}
