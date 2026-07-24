import type { HostMessageService } from "@tripley-kit/web-container-host-message";

import type { BspV243TerminalSnapshot } from "./contracts";
import { bspV243HostControlReference, bspV243OexResponseReference } from "./profile";

export const terminalSnapshot: BspV243TerminalSnapshot = {
  atmId: "12345",
  businessDate: "20260724",
  sequence: "00000001",
  systemDate: "20260724",
  versionDate: "20260317",
};

export const packOexResponse = (
  messages: HostMessageService,
  overrides: Partial<Record<string, string>> = {},
): Uint8Array => {
  const packed = messages.pack({
    fields: {
      hostTransactionCode: "OEX",
      hostDate: "20260724",
      hostTime: "120000",
      hostAtmId: terminalSnapshot.atmId,
      hostMode: "1",
      hostBusinessDate: terminalSnapshot.businessDate,
      hostDepositMode: "2",
      hostSystemDate: terminalSnapshot.systemDate,
      hostSequence: terminalSnapshot.sequence,
      oexRejectCode: "0000",
      oexReplyFiller: "",
      ...overrides,
    },
    reference: bspV243OexResponseReference,
  });
  if (packed.status !== "packed") throw new Error(packed.error.code);
  return packed.message.bytes;
};

export const packHostControl = (
  messages: HostMessageService,
  code: string,
  body = "",
): Uint8Array => {
  const packed = messages.pack({
    fields: {
      hostTransactionCode: code,
      hostDate: "20260724",
      hostTime: "120001",
      hostAtmId: terminalSnapshot.atmId,
      hostMode: "1",
      hostBusinessDate: terminalSnapshot.businessDate,
      hostDepositMode: "2",
      hostSystemDate: terminalSnapshot.systemDate,
      hostSequence: "00000002",
      hostControlBody: body,
    },
    reference: bspV243HostControlReference,
  });
  if (packed.status !== "packed") throw new Error(packed.error.code);
  return packed.message.bytes;
};
