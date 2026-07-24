import type {
  HostMessageProfile,
  HostMessageReference,
} from "@tripley-kit/web-container-host-message";

import { bspField, uses } from "./profile-fields";

export const BSP_V243_PROFILE_ID = "taiwan.bsp.atm";
export const BSP_V243_PROFILE_VERSION = "2.43-20260317";
export const BSP_V243_ATM_MESSAGE_BYTES = 720;

export const bspV243OexRequestReference: HostMessageReference = {
  messageId: "oex.request",
  profileId: BSP_V243_PROFILE_ID,
  profileVersion: BSP_V243_PROFILE_VERSION,
};

export const bspV243OexResponseReference: HostMessageReference = {
  messageId: "oex.response",
  profileId: BSP_V243_PROFILE_ID,
  profileVersion: BSP_V243_PROFILE_VERSION,
};

export const bspV243HostControlReference: HostMessageReference = {
  messageId: "host.control",
  profileId: BSP_V243_PROFILE_ID,
  profileVersion: BSP_V243_PROFILE_VERSION,
};

const requestHeader = [
  "requestTransmissionArea",
  "requestTransactionCode",
  "requestVersionMarker",
  "requestVersionDate",
  "requestAtmId",
  "requestDeviceStatus",
  "requestServiceStatus",
  "requestMode",
  "requestBusinessDate",
  "requestDepositMode",
  "requestSystemDate",
  "requestSequence",
] as const;

const oexBody = [
  "oexHostSequence",
  "oexAtmSystemDate",
  "oexAtmSequence",
  "oexStatusReason",
  "oexBusinessDay",
  "oexStoppedDate",
  "oexStoppedTime",
  "oexRestoredDate",
  "oexRestoredTime",
  "oexStopReason",
  "oexRestartVersion",
  "oexTreat051",
  "oexMessageType",
  "oexCountry",
  "oexProgramVersion",
  "oexAdvertisementVersion",
  "oexFormatMarker",
  "oexCassetteStatusArea",
  "oexSecondaryDeviceStatus",
  "oexFiller",
] as const;

const hostHeader = [
  "hostTransactionCode",
  "hostDate",
  "hostTime",
  "hostAtmId",
  "hostMode",
  "hostBusinessDate",
  "hostDepositMode",
  "hostSystemDate",
  "hostSequence",
] as const;

export const bspV243Profile: HostMessageProfile = {
  codecId: "fixed-field",
  fieldDefinitions: [
    bspField("requestTransmissionArea", 2),
    bspField("requestTransactionCode", 3, { summary: { mode: "value" } }),
    bspField("requestVersionMarker", 1),
    bspField("requestVersionDate", 8, { numeric: true }),
    bspField("requestAtmId", 5, { numeric: true, summary: { mode: "value" } }),
    bspField("requestDeviceStatus", 12, { numeric: true }),
    bspField("requestServiceStatus", 1, { numeric: true, summary: { mode: "value" } }),
    bspField("requestMode", 1, { numeric: true, summary: { mode: "value" } }),
    bspField("requestBusinessDate", 8, { numeric: true }),
    bspField("requestDepositMode", 1, { numeric: true }),
    bspField("requestSystemDate", 8, { numeric: true }),
    bspField("requestSequence", 8, { numeric: true }),
    bspField("oexHostSequence", 7, { numeric: true }),
    bspField("oexAtmSystemDate", 8, { numeric: true }),
    bspField("oexAtmSequence", 8, { numeric: true }),
    bspField("oexStatusReason", 4, { summary: { mode: "value" } }),
    bspField("oexBusinessDay", 2, { numeric: true }),
    bspField("oexStoppedDate", 8, { numeric: true }),
    bspField("oexStoppedTime", 4, { numeric: true }),
    bspField("oexRestoredDate", 8, { numeric: true }),
    bspField("oexRestoredTime", 4, { numeric: true }),
    bspField("oexStopReason", 4),
    bspField("oexRestartVersion", 8, { numeric: true }),
    bspField("oexTreat051", 1, { numeric: true }),
    bspField("oexMessageType", 2),
    bspField("oexCountry", 3, { summary: { mode: "value" } }),
    bspField("oexProgramVersion", 8, { numeric: true }),
    bspField("oexAdvertisementVersion", 8, { numeric: true }),
    bspField("oexFormatMarker", 1),
    bspField("oexCassetteStatusArea", 210),
    bspField("oexSecondaryDeviceStatus", 5, { numeric: true }),
    bspField("oexFiller", 297),
    bspField("requestNotesFiveToEight", 4, { numeric: true }),
    bspField("requestTailFiller", 58),
    bspField("hostTransactionCode", 3, { summary: { mode: "value" } }),
    bspField("hostDate", 8, { numeric: true }),
    bspField("hostTime", 6, { numeric: true }),
    bspField("hostAtmId", 5, { numeric: true, summary: { mode: "value" } }),
    bspField("hostMode", 1, { numeric: true, summary: { mode: "value" } }),
    bspField("hostBusinessDate", 8, { numeric: true }),
    bspField("hostDepositMode", 1, { numeric: true }),
    bspField("hostSystemDate", 8, { numeric: true }),
    bspField("hostSequence", 8, { numeric: true }),
    bspField("oexRejectCode", 4, { summary: { mode: "value" } }),
    bspField("oexReplyFiller", 668),
    bspField("hostControlBody", 672),
  ],
  id: BSP_V243_PROFILE_ID,
  maxMessageBytes: 1_024,
  messages: [
    {
      direction: "request",
      fields: uses(...requestHeader, ...oexBody, "requestNotesFiveToEight", "requestTailFiller"),
      id: bspV243OexRequestReference.messageId,
    },
    {
      direction: "response",
      fields: uses(...hostHeader, "oexRejectCode", "oexReplyFiller"),
      id: bspV243OexResponseReference.messageId,
    },
    {
      direction: "advice",
      fields: uses(...hostHeader, "hostControlBody"),
      id: bspV243HostControlReference.messageId,
    },
  ],
  version: BSP_V243_PROFILE_VERSION,
};
