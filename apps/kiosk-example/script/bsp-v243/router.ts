import type {
  PersistentHostFrameRoute,
  PersistentHostFrameRouteInput,
} from "@tripley-kit/web-container-kiosk-host-native-channel";

import type { BspV243PendingResponseInput } from "./contracts";
import type { BspV243HostControlRegistry } from "./control-registry";
import { BSP_V243_HOST_MESSAGE_BYTES } from "./profile";

export interface BspV243FrameRouterOptions {
  readonly controls: Pick<BspV243HostControlRegistry, "typeFor">;
  resolvePendingResponse?(
    input: BspV243PendingResponseInput,
  ): { readonly responseId?: string | undefined } | undefined;
}

export const createBspV243FrameRouter =
  (options: BspV243FrameRouterOptions) =>
  (input: PersistentHostFrameRouteInput): PersistentHostFrameRoute => {
    if (input.payload.length !== BSP_V243_HOST_MESSAGE_BYTES) {
      return { kind: "ignore", reason: "bsp.v243.host-frame-length-invalid" };
    }
    const code = readAscii(input.payload, 0, 3);
    const type = options.controls.typeFor(code);
    if (type) {
      return { kind: "inbound", messageId: hostMessageId(input.payload), type };
    }
    if (input.pending?.idempotencyKey.startsWith("bsp-v243:oex:") && code === "OEX") {
      return { kind: "response", responseId: hostMessageId(input.payload) };
    }
    if (input.pending && options.resolvePendingResponse) {
      const resolved = options.resolvePendingResponse({
        code,
        payload: input.payload,
        pending: input.pending,
      });
      if (resolved) return { kind: "response", responseId: resolved.responseId };
    }
    return { kind: "ignore", reason: "bsp.v243.host-message-unmatched" };
  };

const hostMessageId = (payload: Uint8Array): string => {
  const code = readAscii(payload, 0, 3);
  const date = readAscii(payload, 3, 8);
  const time = readAscii(payload, 11, 6);
  const atmId = readAscii(payload, 17, 5);
  const sequence = readAscii(payload, 40, 8);
  return `bsp-v243:${code}:${date}${time}:${atmId}:${sequence}`;
};

const readAscii = (payload: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...payload.slice(offset, offset + length));
