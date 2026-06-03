export type HostCommand =
  | { kind: "pause-service"; reason?: string }
  | { kind: "resume-service" }
  | { kind: "enter-maintenance"; reason?: string }
  | { kind: "exit-maintenance" };

export interface HostMessageCodec<TRequest, TResponse> {
  encode(request: TRequest): BodyInit;
  decode(response: Response): Promise<TResponse>;
}

export interface HostCommandParser<TMessage> {
  parse(message: TMessage): HostCommand | undefined;
}

export interface HostTransport<TRequest, TResponse> {
  send(request: TRequest): Promise<TResponse>;
}

export interface HttpJsonTransportOptions {
  endpoint: string | (() => string);
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

export class HttpJsonTransport<TRequest, TResponse> implements HostTransport<TRequest, TResponse> {
  private readonly fetch: typeof globalThis.fetch;

  public constructor(private readonly options: HttpJsonTransportOptions) {
    if (options.fetch === undefined && globalThis.fetch === undefined) {
      throw new Error("HTTP JSON host transport requires a fetch implementation.");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  public async send(request: TRequest): Promise<TResponse> {
    const endpoint =
      typeof this.options.endpoint === "string" ? this.options.endpoint : this.options.endpoint();
    const response = await this.fetch(endpoint, {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json", ...this.options.headers },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Host HTTP request failed with status ${response.status}.`);
    }
    return (await response.json()) as TResponse;
  }
}
