import type {
  HostGateway,
  HostRequest,
  HostResponse,
  HostSendOptions,
} from "@tripley-acctron/contracts";

export interface SentHostRequest {
  messageType: string;
  body: unknown;
  options?: HostSendOptions;
}

type QueuedHostResult =
  | { type: "response"; response: HostResponse }
  | { type: "failure"; error: unknown };

export class FakeHostGateway implements HostGateway {
  public readonly sent: SentHostRequest[] = [];
  private readonly queued: QueuedHostResult[] = [];
  private nextRequestId = 1;

  public enqueueResponse<TBody = unknown>(
    body: TBody,
    status: HostResponse<TBody>["status"] = "approved",
  ): void {
    this.queued.push({
      type: "response",
      response: {
        requestId: `fake-host-${this.nextRequestId++}`,
        status,
        body,
      },
    });
  }

  public enqueueFailure(error: unknown): void {
    this.queued.push({ type: "failure", error });
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
    options?: HostSendOptions,
  ): Promise<HostResponse<TRes>> {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    this.sent.push({
      messageType: request.messageType,
      body: request.body,
      ...(options ? { options } : {}),
    });

    const next = this.queued.shift();
    if (!next) {
      return {
        requestId: `fake-host-${this.nextRequestId++}`,
        status: "approved",
        body: undefined as TRes,
      };
    }

    if (next.type === "failure") {
      throw next.error;
    }

    return next.response as HostResponse<TRes>;
  }
}
