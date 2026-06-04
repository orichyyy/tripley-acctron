import {
  KioskError,
  type CanonicalHostMessage,
  type Disposable,
  type HostCodec,
  type HostCommandHandler,
  type HostGateway,
  type HostMessageMapper,
  type HostRequest,
  type HostResponse,
  type HostSendOptions,
  type HostTransport,
  type Logger,
} from "@tripley-acctron/contracts";
import { createSequentialIdGenerator, type IdGenerator } from "./id-generator";

interface PendingRequest<TBody = unknown> {
  requestId: string;
  timer?: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
  signal?: AbortSignal;
  resolve(response: HostResponse<TBody>): void;
  reject(error: unknown): void;
}

export interface DefaultHostGatewayOptions<RawMessage> {
  transport: HostTransport;
  codec: HostCodec<RawMessage>;
  mapper: HostMessageMapper<RawMessage>;
  logger: Logger;
  onCommand?: HostCommandHandler;
  requestId?: IdGenerator;
  traceId?: IdGenerator;
}

export class DefaultHostGateway<RawMessage = unknown> implements HostGateway {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestId: IdGenerator;
  private readonly traceId: IdGenerator;
  private subscription?: Disposable;
  private connected = false;

  public constructor(private readonly options: DefaultHostGatewayOptions<RawMessage>) {
    this.requestId = options.requestId ?? createSequentialIdGenerator("host-request");
    this.traceId = options.traceId ?? createSequentialIdGenerator("host-trace");
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.options.transport.connect();
    this.subscription = this.options.transport.onData((data) => {
      void this.handleData(data).catch((error: unknown) => {
        this.options.logger.error("Host message handling failed.", { error });
      });
    });
    this.connected = true;
  }

  public async close(): Promise<void> {
    await this.subscription?.dispose();
    delete this.subscription;
    await this.options.transport.close();
    this.connected = false;
    for (const pending of this.pending.values()) {
      this.cleanupPending(pending);
      pending.reject(new KioskError("host.timeout", "Host gateway closed with a pending request."));
    }
    this.pending.clear();
  }

  public send<TReq = unknown, TRes = unknown>(
    messageType: string,
    body: TReq,
    options?: HostSendOptions,
  ): Promise<HostResponse<TRes>> {
    return this.request({ messageType, body }, options);
  }

  public async request<TReq = unknown, TRes = unknown>(
    request: HostRequest<TReq>,
    options: HostSendOptions = {},
  ): Promise<HostResponse<TRes>> {
    await this.connect();
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const requestId = this.requestId();
    const traceId = options.traceId ?? this.traceId();
    const response = new Promise<HostResponse<TRes>>((resolve, reject) => {
      const pending: PendingRequest<TRes> = {
        requestId,
        resolve,
        reject,
      };
      if (options.signal) {
        pending.signal = options.signal;
      }
      this.installTimeout(pending, options.timeoutMs);
      this.installAbort(pending, options.signal);
      this.pending.set(requestId, pending);
    });

    const message: CanonicalHostMessage = {
      type: "request",
      requestId,
      messageType: request.messageType,
      traceId,
      body: request.body,
    };

    try {
      await this.sendCanonical(message);
    } catch (error) {
      this.rejectPending(requestId, error);
    }

    return response;
  }

  private async sendCanonical(message: CanonicalHostMessage): Promise<void> {
    const raw = this.options.mapper.fromCanonical(message);
    const encoded = this.options.codec.encode(raw);
    await this.options.transport.send(encoded);
  }

  private async handleData(data: Uint8Array | string): Promise<void> {
    const raw = this.options.codec.decode(data);
    const message = this.options.mapper.toCanonical(raw);
    switch (message.type) {
      case "response":
        this.resolveResponse(message);
        return;
      case "command":
        await this.options.onCommand?.(message.command, message.traceId);
        return;
      case "notification":
        this.options.logger.info("Host notification received.", {
          name: message.name,
          body: message.body,
        });
        return;
      case "request":
        this.options.logger.warn("Inbound host request ignored by gateway.", {
          requestId: message.requestId,
          messageType: message.messageType,
        });
        return;
    }
  }

  private resolveResponse(message: Extract<CanonicalHostMessage, { type: "response" }>): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      this.options.logger.warn("Host response had no pending request.", {
        requestId: message.requestId,
      });
      return;
    }

    this.pending.delete(message.requestId);
    this.cleanupPending(pending);
    pending.resolve({
      requestId: message.requestId,
      status: message.status,
      body: message.body,
    });
  }

  private installTimeout(pending: PendingRequest, timeoutMs: number | undefined): void {
    if (!timeoutMs) {
      return;
    }
    pending.timer = setTimeout(() => {
      this.pending.delete(pending.requestId);
      this.cleanupPending(pending);
      pending.reject(new KioskError("host.timeout", "Host request timed out."));
    }, timeoutMs);
  }

  private installAbort(pending: PendingRequest, signal: AbortSignal | undefined): void {
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      pending.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const abortHandler = () => {
      this.pending.delete(pending.requestId);
      this.cleanupPending(pending);
      pending.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    pending.abortHandler = abortHandler;
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  private rejectPending(requestId: string, error: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(requestId);
    this.cleanupPending(pending);
    pending.reject(error);
  }

  private cleanupPending(pending: PendingRequest): void {
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    if (pending.abortHandler && pending.signal) {
      pending.signal.removeEventListener("abort", pending.abortHandler);
    }
  }
}
