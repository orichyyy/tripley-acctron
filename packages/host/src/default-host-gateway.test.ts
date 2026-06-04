import { describe, expect, test, vi } from "vitest";
import type { CanonicalHostMessage, HostTransport } from "@tripley-acctron/contracts";
import { InMemoryLogger } from "@tripley-acctron/observability";
import { DefaultHostGateway } from "./default-host-gateway";
import { IdentityHostMessageMapper } from "./identity-host-message-mapper";
import { JsonHostCodec } from "./json-host-codec";

describe("default host gateway", () => {
  test("json codec roundtrips messages", () => {
    const codec = new JsonHostCodec<CanonicalHostMessage>();
    const message: CanonicalHostMessage = {
      type: "notification",
      name: "hello",
      body: { ok: true },
    };

    expect(codec.decode(codec.encode(message))).toEqual(message);
  });

  test("request sends canonical message and resolves matching response", async () => {
    const transport = new MemoryHostTransport();
    const gateway = createGateway(transport);

    const response = gateway.request(
      { messageType: "accountInquiry", body: { account: "123" } },
      { traceId: "trace-1" },
    );
    await flushPromises();

    expect(JSON.parse(transport.sent[0] as string)).toEqual({
      type: "request",
      requestId: "request-1",
      messageType: "accountInquiry",
      traceId: "trace-1",
      body: { account: "123" },
    });

    transport.receive({
      type: "response",
      requestId: "request-1",
      status: "approved",
      body: { balance: 10 },
    });

    await expect(response).resolves.toEqual({
      requestId: "request-1",
      status: "approved",
      body: { balance: 10 },
    });
  });

  test("timeout rejects and ignores late response", async () => {
    vi.useFakeTimers();
    try {
      const transport = new MemoryHostTransport();
      const gateway = createGateway(transport);
      const response = gateway.request({ messageType: "slow", body: {} }, { timeoutMs: 100 });
      await flushPromises();

      vi.advanceTimersByTime(100);

      await expect(response).rejects.toMatchObject({ code: "host.timeout" });
      transport.receive({
        type: "response",
        requestId: "request-1",
        status: "approved",
        body: {},
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("abort rejects pending request", async () => {
    const transport = new MemoryHostTransport();
    const gateway = createGateway(transport);
    const controller = new AbortController();
    const response = gateway.request(
      { messageType: "abortable", body: {} },
      { signal: controller.signal },
    );
    await flushPromises();

    controller.abort(new Error("aborted"));

    await expect(response).rejects.toThrow("aborted");
  });

  test("inbound host command invokes handler", async () => {
    const transport = new MemoryHostTransport();
    const commands: string[] = [];
    const gateway = createGateway(transport, (command) => {
      commands.push(command.type);
    });

    await gateway.connect();
    transport.receive({
      type: "command",
      traceId: "trace-1",
      command: { type: "resumeService" },
    });
    await flushPromises();

    expect(commands).toEqual(["resumeService"]);
  });
});

function createGateway(
  transport: MemoryHostTransport,
  onCommand?: ConstructorParameters<
    typeof DefaultHostGateway<CanonicalHostMessage>
  >[0]["onCommand"],
) {
  return new DefaultHostGateway<CanonicalHostMessage>({
    transport,
    codec: new JsonHostCodec<CanonicalHostMessage>(),
    mapper: new IdentityHostMessageMapper(),
    logger: new InMemoryLogger(),
    requestId: createIds("request"),
    traceId: createIds("trace"),
    ...(onCommand ? { onCommand } : {}),
  });
}

function createIds(prefix: string) {
  let next = 1;
  return () => `${prefix}-${next++}`;
}

class MemoryHostTransport implements HostTransport {
  public readonly sent: Array<Uint8Array | string> = [];
  private handler: ((data: Uint8Array | string) => void) | undefined;

  public async connect(): Promise<void> {}

  public async send(data: Uint8Array | string): Promise<void> {
    this.sent.push(data);
  }

  public onData(handler: (data: Uint8Array | string) => void) {
    this.handler = handler;
    return {
      dispose: () => {
        this.handler = undefined;
      },
    };
  }

  public async close(): Promise<void> {
    this.handler = undefined;
  }

  public receive(message: CanonicalHostMessage): void {
    this.handler?.(JSON.stringify(message));
  }
}

async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
