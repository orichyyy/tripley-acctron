import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { NativeTcpHostTransportAdapter } from "./native-tcp";

describe("native TCP host transport", () => {
  it("writes one framed request, reassembles response chunks, and releases native resources", async () => {
    let handler: ((event: NativeTcpEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const close = vi.fn(async () => undefined);
    const write = vi.fn(async (socketId: string, _data: Uint8Array) => {
      const response = new TextEncoder().encode("0008APPROVED");
      handler?.(event(socketId, response.slice(0, 6)));
      handler?.(event(socketId, response.slice(6)));
    });
    const adapter = new NativeTcpHostTransportAdapter(
      {
        close,
        connect: vi.fn(async () => "socket-1"),
        end: vi.fn(async () => undefined),
        onEvent: (next) => {
          handler = next;
          return { unsubscribe };
        },
        write,
      },
      config(),
    );

    await expect(adapter.exchange(request())).resolves.toMatchObject({
      payload: new TextEncoder().encode("APPROVED"),
      responseId: "request-1:response",
      status: "response",
    });
    expect(new TextDecoder().decode(write.mock.calls[0]?.[1])).toBe("0011E1234560000");
    expect(close).toHaveBeenCalledWith("socket-1");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("classifies connect failure as notSent and releases its event subscription", async () => {
    const unsubscribe = vi.fn();
    const adapter = new NativeTcpHostTransportAdapter(
      {
        close: vi.fn(async () => undefined),
        connect: vi.fn(async () => {
          throw new Error("refused");
        }),
        end: vi.fn(async () => undefined),
        onEvent: () => ({ unsubscribe }),
        write: vi.fn(async () => undefined),
      },
      config(),
    );

    await expect(adapter.exchange(request())).resolves.toEqual({
      errorCode: "host.channel.connect-failed",
      status: "notSent",
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("classifies every write-stage failure as unknown", async () => {
    const close = vi.fn(async () => undefined);
    const adapter = new NativeTcpHostTransportAdapter(
      {
        close,
        connect: vi.fn(async () => "socket-1"),
        end: vi.fn(async () => undefined),
        onEvent: () => ({ unsubscribe: vi.fn() }),
        write: vi.fn(async () => {
          throw new Error("partial write possible");
        }),
      },
      config(),
    );

    await expect(adapter.exchange(request())).resolves.toEqual({
      errorCode: "host.channel.write-failed",
      status: "unknown",
    });
    expect(close).toHaveBeenCalledWith("socket-1");
  });

  it("classifies response timeout after accepted write as unknown", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new NativeTcpHostTransportAdapter(
        {
          close: vi.fn(async () => undefined),
          connect: vi.fn(async () => "socket-1"),
          end: vi.fn(async () => undefined),
          onEvent: () => ({ unsubscribe: vi.fn() }),
          write: vi.fn(async () => undefined),
        },
        config(),
      );
      const result = adapter.exchange(request());
      await vi.advanceTimersByTimeAsync(101);
      await expect(result).resolves.toEqual({
        errorCode: "host.channel.response-timeout",
        status: "unknown",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails fast when TLS is required but the native capability is absent", () => {
    expect(
      () =>
        new NativeTcpHostTransportAdapter(
          {
            close: vi.fn(async () => undefined),
            connect: vi.fn(async () => "socket-1"),
            end: vi.fn(async () => undefined),
            onEvent: () => ({ unsubscribe: vi.fn() }),
            write: vi.fn(async () => undefined),
          },
          {
            ...config(),
            security: { mode: "tls" },
          },
        ),
    ).toThrow("host.channel.tls-capability-required");
  });

  it("cancels an active response wait during adapter disposal", async () => {
    const close = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    const adapter = new NativeTcpHostTransportAdapter(
      {
        close,
        connect: vi.fn(async () => "socket-1"),
        end: vi.fn(async () => undefined),
        onEvent: () => ({ unsubscribe: vi.fn() }),
        write,
      },
      config(),
    );
    const pending = adapter.exchange(request());
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

    await adapter.dispose();
    await expect(pending).resolves.toEqual({
      errorCode: "host.channel.disposed-after-connect",
      status: "unknown",
    });
    expect(close).toHaveBeenCalledWith("socket-1");
  });
});

const config = () => ({
  connectTimeoutMs: 100,
  frame: createAsciiLengthPrefixFrameCodec({
    lengthIncludesPrefix: false,
    maxFrameBytes: 64,
    prefixBytes: 4,
  }),
  host: "127.0.0.1",
  id: "native.tcp.host-simulator",
  port: 7001,
  responseTimeoutMs: 100,
  security: { mode: "plain" as const },
  writeTimeoutMs: 100,
});

const request = () => ({
  channel: "simulator",
  idempotencyKey: "request-1",
  payload: new TextEncoder().encode("E1234560000"),
  timeoutMs: 100,
});

const event = (id: string, data: Uint8Array): NativeTcpEvent => ({
  data,
  id,
  kind: "data",
  message: null,
  parentId: null,
});
