import type { HostFieldSet, HostMessageService } from "@tripley-kit/web-container-host-message";
import { HostInboundMessageRegistry } from "@tripley-kit/web-container-kiosk-host-native-channel";

import type { BspV243HostControlContribution, BspV243HostControlMessage } from "./contracts";
import { bspV243HostControlReference } from "./profile";

export const BSP_V243_BUILT_IN_CONTROL_TYPES: Readonly<Record<string, string>> = Object.freeze({
  CLS: "bsp.control.close-service",
  OPN: "bsp.control.open-service",
  PMD: "bsp.control.marquee",
  RBT: "bsp.control.reboot",
  SNS: "bsp.control.line-test",
});

export class BspV243HostControlRegistry {
  private readonly contributions = new Map<string, BspV243HostControlContribution>();
  private frozen = false;

  public constructor(private readonly messages: HostMessageService) {}

  public register(contribution: BspV243HostControlContribution): this {
    if (this.frozen) throw new Error("BspV243HostControlRegistry is frozen");
    if (!/^[A-Z0-9]{3}$/.test(contribution.code) || this.contributions.has(contribution.code)) {
      throw new Error(`BSP host control is invalid or duplicated: ${contribution.code}`);
    }
    if (!contribution.id || !contribution.type) {
      throw new Error("BSP host control identity is required");
    }
    this.contributions.set(contribution.code, contribution);
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public typeFor(code: string): string | undefined {
    return this.contributions.get(code)?.type ?? BSP_V243_BUILT_IN_CONTROL_TYPES[code];
  }

  public createInboundRegistry(): HostInboundMessageRegistry {
    this.freeze();
    const inbound = new HostInboundMessageRegistry();
    for (const contribution of this.contributions.values()) {
      inbound.register({
        id: contribution.id,
        type: contribution.type,
        handle: async (message, context) => {
          const decoded = this.decode(message.payload, contribution.code);
          await contribution.handle(decoded, { respond: (payload) => context.respond(payload) });
        },
      });
    }
    return inbound.freeze();
  }

  public decode(payload: Uint8Array, expectedCode?: string): BspV243HostControlMessage {
    const decoded = this.messages.unpack({
      allowPartial: false,
      bytes: payload,
      reference: bspV243HostControlReference,
    });
    if (decoded.status !== "complete") throw new Error("bsp.v243.control.invalid");
    const fields = decoded.message.fields;
    const code = field(fields, "hostTransactionCode");
    if (expectedCode && code !== expectedCode) throw new Error("bsp.v243.control.code-mismatch");
    return {
      atmId: field(fields, "hostAtmId"),
      body: field(fields, "hostControlBody"),
      businessDate: field(fields, "hostBusinessDate"),
      code,
      date: field(fields, "hostDate"),
      depositMode: field(fields, "hostDepositMode"),
      mode: field(fields, "hostMode"),
      sequence: field(fields, "hostSequence"),
      systemDate: field(fields, "hostSystemDate"),
      time: field(fields, "hostTime"),
    };
  }
}

const field = (fields: HostFieldSet, id: string): string => {
  const value = fields[id];
  return typeof value === "string" ? value : "";
};
