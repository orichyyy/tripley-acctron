import type {
  HostFieldSet,
  HostMessageService,
  SafeHostMessageSummary,
} from "@tripley-kit/web-container-host-message";
import type {
  HostSessionControlResult,
  HostSessionProtocol,
} from "@tripley-kit/web-container-kiosk-host-session";

import type { BspV243TerminalSnapshot, BspV243TerminalStateProvider } from "./contracts";
import {
  BSP_V243_ATM_MESSAGE_BYTES,
  bspV243OexRequestReference,
  bspV243OexResponseReference,
} from "./profile";

export interface BspV243OexProtocolOptions {
  readonly messages: HostMessageService;
  readonly terminalState: BspV243TerminalStateProvider;
  readonly channel?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly acceptedRejectCodes?: readonly string[] | undefined;
}

export type BspV243OexDecodeResult =
  | {
      readonly status: "accepted";
      readonly summary: SafeHostMessageSummary;
    }
  | { readonly status: "rejected"; readonly errorCode: string };

export const createBspV243OexProtocol = (
  options: BspV243OexProtocolOptions,
): HostSessionProtocol => ({
  async establish(context): Promise<HostSessionControlResult> {
    const snapshot = await options.terminalState();
    const packed = packBspV243OexRequest(options.messages, snapshot);
    if (packed.status !== "packed") {
      return { status: "failed", errorCode: "bsp.v243.oex.pack-failed" };
    }
    const exchange = await context.exchange({
      channel: options.channel ?? "bsp.primary",
      idempotencyKey: `bsp-v243:oex:${context.generation}:${snapshot.systemDate}${snapshot.sequence}`,
      payload: packed.message.bytes,
      timeoutMs: options.timeoutMs ?? 15_000,
    });
    if (exchange.status !== "response") {
      return { status: "failed", errorCode: `bsp.v243.oex.transport-${exchange.status}` };
    }
    const decoded = decodeBspV243OexResponse(
      options.messages,
      exchange.payload,
      snapshot.atmId,
      options.acceptedRejectCodes,
    );
    return decoded.status === "accepted"
      ? { status: "accepted" }
      : { status: "failed", errorCode: decoded.errorCode };
  },
});

export const packBspV243OexRequest = (
  messages: HostMessageService,
  snapshot: BspV243TerminalSnapshot,
) =>
  messages.pack({
    fields: createOexRequestFields(snapshot),
    reference: bspV243OexRequestReference,
  });

export const decodeBspV243OexResponse = (
  messages: HostMessageService,
  payload: Uint8Array,
  expectedAtmId: string,
  acceptedRejectCodes: readonly string[] = ["", "0000"],
): BspV243OexDecodeResult => {
  const decoded = messages.unpack({
    allowPartial: false,
    bytes: payload,
    reference: bspV243OexResponseReference,
  });
  if (decoded.status !== "complete") {
    return { status: "rejected", errorCode: "bsp.v243.oex.response-invalid" };
  }
  const fields = decoded.message.fields;
  if (stringValue(fields, "hostTransactionCode") !== "OEX") {
    return { status: "rejected", errorCode: "bsp.v243.oex.response-code-mismatch" };
  }
  if (stringValue(fields, "hostAtmId") !== expectedAtmId) {
    return { status: "rejected", errorCode: "bsp.v243.oex.response-atm-mismatch" };
  }
  if (!acceptedRejectCodes.includes(stringValue(fields, "oexRejectCode"))) {
    return { status: "rejected", errorCode: "bsp.v243.oex.rejected" };
  }
  return { status: "accepted", summary: messages.safeSummary(decoded.message) };
};

const createOexRequestFields = (snapshot: BspV243TerminalSnapshot): HostFieldSet => ({
  requestTransmissionArea: snapshot.transmissionArea ?? "",
  requestTransactionCode: "OEX",
  requestVersionMarker: "A",
  requestVersionDate: snapshot.versionDate,
  requestAtmId: snapshot.atmId,
  requestDeviceStatus: snapshot.deviceStatus ?? "000000000000",
  requestServiceStatus: snapshot.serviceStatus ?? "0",
  requestMode: snapshot.mode ?? "1",
  requestBusinessDate: snapshot.businessDate,
  requestDepositMode: snapshot.depositMode ?? "2",
  requestSystemDate: snapshot.systemDate,
  requestSequence: snapshot.sequence,
  oexHostSequence: snapshot.hostTransactionSequence ?? "0000000",
  oexAtmSystemDate: snapshot.systemDate,
  oexAtmSequence: snapshot.sequence,
  oexStatusReason: snapshot.statusReason ?? "B001",
  oexBusinessDay: snapshot.businessDate.slice(-2),
  oexStoppedDate: snapshot.stoppedDate ?? "00000000",
  oexStoppedTime: snapshot.stoppedTime ?? "0000",
  oexRestoredDate: snapshot.restoredDate ?? "00000000",
  oexRestoredTime: snapshot.restoredTime ?? "0000",
  oexStopReason: snapshot.stopReason ?? "",
  oexRestartVersion: snapshot.versionDate,
  oexTreat051: snapshot.treat051AsOwnCard ?? "0",
  oexMessageType: snapshot.messageType ?? "",
  oexCountry: snapshot.country ?? "TWN",
  oexProgramVersion: snapshot.programVersion ?? snapshot.versionDate,
  oexAdvertisementVersion: snapshot.advertisementVersion ?? snapshot.versionDate,
  oexFormatMarker: "N",
  oexCassetteStatusArea: snapshot.cassetteStatusArea ?? "",
  oexSecondaryDeviceStatus: snapshot.secondaryDeviceStatus ?? "00000",
  oexFiller: "",
  requestNotesFiveToEight: snapshot.notesFiveToEight ?? "0000",
  requestTailFiller: "",
});

const stringValue = (fields: HostFieldSet, id: string): string => {
  const value = fields[id];
  return typeof value === "string" ? value : "";
};

export const assertBspV243OexLength = (payload: Uint8Array): boolean =>
  payload.length === BSP_V243_ATM_MESSAGE_BYTES;
