import {
  type HostMessageProfile,
  createHostMessageService,
} from "@tripley-kit/web-container-host-message";
import {
  HostMessageBindingRegistry,
  HostMessageTransportAdapter,
  HostWireTransportRegistry,
} from "@tripley-kit/web-container-kiosk-host-integration";
import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { NativeTcpHostTransportAdapter } from "./native-tcp";

describe("native TCP Host Message vertical slice", () => {
  it("returns a profile-safe summary from a framed native response", async () => {
    const messages = createHostMessageService({ profiles: [profile] }).service;
    const response = messages.pack({
      fields: { authorizationReference: "AUTH01", responseCode: "00" },
      reference: responseReference,
    });
    if (response.status !== "packed") throw new Error("response fixture failed");
    let handler: ((event: NativeTcpEvent) => void) | undefined;
    const frame = createAsciiLengthPrefixFrameCodec({
      lengthIncludesPrefix: false,
      maxFrameBytes: 128,
      prefixBytes: 4,
    });
    const native = new NativeTcpHostTransportAdapter(
      {
        close: vi.fn(async () => undefined),
        connect: vi.fn(async () => "socket-1"),
        end: vi.fn(async () => undefined),
        onEvent: (next) => {
          handler = next;
          return { unsubscribe: vi.fn() };
        },
        write: vi.fn(async (socketId: string, _data: Uint8Array) => {
          handler?.({
            data: frame.encode(response.message.bytes),
            id: socketId,
            kind: "data",
            message: null,
            parentId: null,
          });
        }),
      },
      {
        connectTimeoutMs: 100,
        frame,
        host: "127.0.0.1",
        id: "native.tcp.test",
        port: 7001,
        responseTimeoutMs: 100,
        security: { mode: "plain" },
        writeTimeoutMs: 100,
      },
    );
    const bindings = new HostMessageBindingRegistry().register({
      channel: "bank.primary",
      deliveryPolicyId: "authorization.standard",
      id: "withdrawal.authorization",
      mapResponse: (fields) => fields,
      messageType: "withdrawal.authorization",
      projectRequest: (fields: Record<string, string>) => fields,
      request: requestReference,
      response: responseReference,
      summarizeRequest: () => ({ operationType: "withdrawal" }),
      timeoutMs: 100,
      transportId: native.id,
      version: "1",
    });
    const transport = new HostMessageTransportAdapter({
      bindings,
      messages,
      transports: new HostWireTransportRegistry().register(native),
    });
    const request = messages.pack({
      fields: { pan: "6222020000000001", pinBlock: "PINBLOCK" },
      reference: requestReference,
    });
    if (request.status !== "packed") throw new Error("request fixture failed");

    const result = await transport.send({
      channel: "bank.primary",
      idempotencyKey: "withdrawal-1",
      messageId: "withdrawal-1:request",
      messageType: "withdrawal.authorization",
      outboxId: "withdrawal-1",
      payload: request.message.bytes,
      transactionId: "withdrawal-1",
    });
    expect(result).toMatchObject({
      safeSummary: {
        decodeStatus: "complete",
        "field.authorizationReference": true,
        "field.responseCode": "00",
      },
      status: "response",
    });
    expect(JSON.stringify(result)).not.toContain("PINBLOCK");
    expect(JSON.stringify(result)).not.toContain("6222020000000001");
  });
});

const requestReference = {
  messageId: "authorization.request",
  profileId: "target52.fixed",
  profileVersion: "1",
};

const responseReference = {
  messageId: "authorization.response",
  profileId: "target52.fixed",
  profileVersion: "1",
};

const profile: HostMessageProfile = {
  codecId: "fixed-field",
  fieldDefinitions: [
    {
      id: "pan",
      dataClassification: "sensitive",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 16 },
    },
    {
      id: "pinBlock",
      dataClassification: "secret",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 8 },
    },
    {
      id: "responseCode",
      dataClassification: "public",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 2 },
    },
    {
      id: "authorizationReference",
      dataClassification: "internal",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 6 },
    },
  ],
  id: "target52.fixed",
  maxMessageBytes: 128,
  messages: [
    {
      direction: "request",
      fields: [
        { fieldId: "pan", kind: "field", presence: "required" },
        { fieldId: "pinBlock", kind: "field", presence: "required" },
      ],
      id: "authorization.request",
    },
    {
      direction: "response",
      fields: [
        { fieldId: "responseCode", kind: "field", presence: "required" },
        { fieldId: "authorizationReference", kind: "field", presence: "required" },
      ],
      id: "authorization.response",
    },
  ],
  version: "1",
};
