import type {
  HostTransportPort,
  SafeHostSummary,
} from "@tripley-kit/web-container-kiosk-host-delivery";

import type { HostMessageTransportOptions } from "./contracts";

export class HostMessageTransportAdapter implements HostTransportPort {
  public constructor(private readonly options: HostMessageTransportOptions) {}

  public async send(input: Parameters<HostTransportPort["send"]>[0]) {
    const binding = this.options.bindings.requireMessageType(input.messageType);
    const result = await this.options.transports.require(binding.transportId).exchange({
      channel: input.channel,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      timeoutMs: binding.timeoutMs,
    });
    if (result.status !== "response") return result;
    const decoded = this.options.messages.unpack({
      allowPartial: false,
      bytes: result.payload,
      reference: binding.response,
    });
    return {
      payload: result.payload,
      responseId: result.responseId,
      safeSummary: responseSummary(this.options.messages, decoded),
      status: "response" as const,
    };
  }
}

const responseSummary = (
  messages: HostMessageTransportOptions["messages"],
  decoded: ReturnType<HostMessageTransportOptions["messages"]["unpack"]>,
): SafeHostSummary => {
  if (decoded.status === "failed") return { decodeStatus: "failed" };
  if (decoded.status === "partial") {
    return {
      consumedBytes: decoded.consumedBytes,
      decodeStatus: "partial",
      messageId: decoded.reference.messageId,
      profileId: decoded.reference.profileId,
      profileVersion: decoded.reference.profileVersion,
      receivedBytes: decoded.receivedBytes,
    };
  }
  const summary = messages.safeSummary(decoded.message);
  const fields = Object.fromEntries(
    Object.entries(summary.fields).map(([key, value]) => [`field.${key}`, value]),
  );
  return {
    decodeStatus: decoded.status,
    messageId: summary.reference.messageId,
    profileId: summary.reference.profileId,
    profileVersion: summary.reference.profileVersion,
    wireLength: summary.wireLength,
    ...fields,
  };
};
