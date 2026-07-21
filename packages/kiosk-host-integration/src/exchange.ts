import type { HostMessageBinding, HostMessageExchangeOptions } from "./contracts";
import { HostExchangeError } from "./errors";

export class DurableHostMessageExchange {
  public constructor(private readonly options: HostMessageExchangeOptions) {
    options.bindings.freeze();
  }

  public async execute<TRequest, TResponse>(input: {
    readonly bindingId: string;
    readonly operationId: string;
    readonly request: TRequest;
  }): Promise<TResponse> {
    const binding = this.options.bindings.require<TRequest, TResponse>(input.bindingId);
    const outboxId = `${input.operationId}:${binding.id}@${binding.version}`;
    const existing = await this.options.delivery.get(outboxId);
    if (existing) return this.resume(binding, outboxId, existing.status);
    const packed = this.options.messages.pack({
      fields: binding.projectRequest(input.request),
      reference: binding.request,
    });
    if (packed.status === "failed") {
      throw new HostExchangeError("host.exchange.encode-failed", "encode", outboxId);
    }
    await this.options.delivery.enqueue({
      channel: binding.channel,
      id: outboxId,
      idempotencyKey: outboxId,
      messageId: `${outboxId}:request`,
      messageType: binding.messageType,
      payload: packed.message.bytes,
      policyId: binding.deliveryPolicyId,
      safeSummary: binding.summarizeRequest(input.request),
      transactionId: input.operationId,
    });
    return this.resume(binding, outboxId, "pending");
  }

  private async resume<TRequest, TResponse>(
    binding: HostMessageBinding<TRequest, TResponse>,
    outboxId: string,
    status: string,
  ): Promise<TResponse> {
    if (status !== "reconciled") await this.options.delivery.dispatch(outboxId);
    const current = await this.options.delivery.get(outboxId);
    if (!current)
      throw new HostExchangeError("host.exchange.delivery-missing", "delivery", outboxId);
    if (current.status !== "reconciled") {
      throw new HostExchangeError(`host.exchange.${current.status}`, "delivery", outboxId);
    }
    return this.readResponse(binding, outboxId);
  }

  private async readResponse<TRequest, TResponse>(
    binding: HostMessageBinding<TRequest, TResponse>,
    outboxId: string,
  ): Promise<TResponse> {
    const stored = await this.options.delivery.readResponse(outboxId);
    if (!stored)
      throw new HostExchangeError("host.exchange.response-missing", "delivery", outboxId);
    const decoded = this.options.messages.unpack({
      allowPartial: false,
      bytes: stored.payload,
      reference: binding.response,
    });
    if (decoded.status !== "complete") {
      throw new HostExchangeError(`host.exchange.decode-${decoded.status}`, "decode", outboxId);
    }
    return binding.mapResponse(decoded.message.fields);
  }
}
