export interface SentHostMessage {
  type: string;
  payload: unknown;
}

export class FakeHostGateway {
  public readonly sent: SentHostMessage[] = [];

  public async send<TResponse>(
    type: string,
    payload: unknown,
    response: TResponse,
  ): Promise<TResponse> {
    this.sent.push({ type, payload });
    return response;
  }
}
