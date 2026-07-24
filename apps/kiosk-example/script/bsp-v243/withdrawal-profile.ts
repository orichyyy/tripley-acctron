import type {
  DataClassification,
  HostMessageProfile,
  SafeSummaryPolicy,
} from "@tripley-kit/web-container-host-message";

import { bspField } from "./profile-fields";

interface WireField {
  readonly id: string;
  readonly bytes: number;
  readonly numeric?: boolean;
  readonly numericPadding?: "space" | "zero";
  readonly classification?: DataClassification;
  readonly summary?: SafeSummaryPolicy;
}

const value = { mode: "value" } as const;
const presence = { mode: "presence" } as const;

const requestHeaderLayout = [
  { id: "inTransmissionArea", bytes: 2 },
  { id: "inTransactionCode", bytes: 3, classification: "public", summary: value },
  { id: "inVersionMarker", bytes: 1 },
  { id: "inVersionDate", bytes: 8, numeric: true },
  { id: "inAtmId", bytes: 5, numeric: true, summary: value },
  { id: "inDeviceStatus", bytes: 12 },
  { id: "inServiceStatus", bytes: 1 },
  { id: "inMode", bytes: 1 },
  { id: "inBusinessDate", bytes: 8, numeric: true },
  { id: "inDepositMode", bytes: 1 },
  { id: "inSystemDate", bytes: 8, numeric: true, summary: value },
  { id: "inSequence", bytes: 8, numeric: true, summary: value },
] as const satisfies readonly WireField[];

export const bspWithdrawalIciLayout = [
  { id: "inBankNumber", bytes: 3, numeric: true },
  {
    id: "inCardAccount",
    bytes: 16,
    numeric: true,
    classification: "sensitive",
    summary: presence,
  },
  {
    id: "inTransactionAccount",
    bytes: 16,
    numeric: true,
    classification: "sensitive",
    summary: presence,
  },
  { id: "inDestinationBank", bytes: 3, numeric: true },
  {
    id: "inDestinationAccount",
    bytes: 16,
    numeric: true,
    classification: "sensitive",
    summary: presence,
  },
  { id: "inPinBlock", bytes: 16, classification: "secret" },
  { id: "inTrack3", bytes: 104, classification: "secret" },
  { id: "inTransactionAmount", bytes: 8, numeric: true, summary: value },
  { id: "inDispenseCount1Low", bytes: 2, numeric: true },
  { id: "inDispenseCount2Low", bytes: 2, numeric: true },
  { id: "inDispenseCount3Low", bytes: 2, numeric: true },
  { id: "inDispenseCount4Low", bytes: 2, numeric: true },
  { id: "inClass", bytes: 5 },
  { id: "inPaymentCancellationNumber", bytes: 16 },
  { id: "inDueDate", bytes: 8, numeric: true },
  { id: "inUnit", bytes: 3 },
  { id: "inIdentityNumber", bytes: 11, classification: "sensitive" },
  { id: "inApply", bytes: 1 },
  { id: "inDate", bytes: 8, numeric: true },
  { id: "inTerminalCheck", bytes: 8, classification: "secret" },
  { id: "inChipDateTime", bytes: 14, numeric: true },
  { id: "inChipMainAccount", bytes: 16, classification: "sensitive" },
  { id: "inChipRemark", bytes: 30, classification: "sensitive" },
  { id: "inChipTransactionSequence", bytes: 8 },
  { id: "inChipTac", bytes: 16, classification: "secret" },
  { id: "inOriginalCenterSequence", bytes: 7, numeric: true, summary: value },
  { id: "inOriginalAtmSystemDate", bytes: 8, numeric: true, summary: value },
  { id: "inOriginalAtmSequence", bytes: 8, numeric: true, summary: value },
  { id: "inExceptionKind", bytes: 1, summary: value },
  { id: "inExceptionNumber", bytes: 3, numeric: true, summary: value },
  { id: "inAtmBusinessDay", bytes: 2, numeric: true },
  { id: "inMacDate", bytes: 6, numeric: true },
  { id: "inMac", bytes: 8, classification: "secret" },
  { id: "inCurrencyCode", bytes: 2, summary: value },
  { id: "inAccountCountFlag", bytes: 1 },
  { id: "inRate", bytes: 10, numeric: true },
  { id: "inTwdEquivalent", bytes: 8, numeric: true },
  { id: "inMiddleRate", bytes: 10, numeric: true },
  { id: "inExchangeDifference", bytes: 10, numeric: true },
  { id: "inCharge", bytes: 13, numeric: true },
  { id: "inFeeOriginalCurrency", bytes: 13, numeric: true },
  { id: "inCashRate", bytes: 10, numeric: true },
  { id: "inDepositType", bytes: 1 },
  { id: "inEnvelopeNumber", bytes: 4 },
  { id: "inDispenseCount1High", bytes: 2, numeric: true },
  { id: "inDispenseCount2High", bytes: 2, numeric: true },
  { id: "inDispenseCount3High", bytes: 2, numeric: true },
  { id: "inDispenseCount4High", bytes: 2, numeric: true },
  { id: "inReceiptNumber", bytes: 12 },
  { id: "inMemo", bytes: 40, classification: "sensitive" },
  { id: "inDispenseCount5", bytes: 4, numeric: true },
  { id: "inDispenseCount6", bytes: 4, numeric: true },
  { id: "inDispenseCount7", bytes: 4, numeric: true },
  { id: "inDispenseCount8", bytes: 4, numeric: true },
  { id: "inDebitCurrencyAmount", bytes: 10, numeric: true },
  { id: "inBalanceCurrency", bytes: 2 },
  { id: "inHandlingChargeCurrency", bytes: 2 },
] as const satisfies readonly WireField[];

const requestTailLayout = [
  { id: "inIwdCardAccountNote", bytes: 28, classification: "sensitive" },
  { id: "inIwdBodyFiller", bytes: 23 },
  { id: "inIwfBodyFiller", bytes: 51 },
  { id: "inNotesFiveToEight", bytes: 4 },
  { id: "inTailFiller", bytes: 58 },
] as const satisfies readonly WireField[];

const responseHeaderLayout = [
  { id: "outTransactionCode", bytes: 3, classification: "public", summary: value },
  { id: "outDate", bytes: 8, numeric: true },
  { id: "outTime", bytes: 6, numeric: true },
  { id: "outAtmId", bytes: 5, numeric: true, summary: value },
  { id: "outMode", bytes: 1 },
  { id: "outBusinessDate", bytes: 8, numeric: true },
  { id: "outDepositMode", bytes: 1 },
  { id: "outSystemDate", bytes: 8, numeric: true, summary: value },
  { id: "outSequence", bytes: 8, numeric: true, summary: value },
  { id: "outRejectCode", bytes: 4, classification: "public", summary: value },
] as const satisfies readonly WireField[];

const iwdResponseBodyLayout = [
  { id: "outCenterSequence", bytes: 7, numeric: true, summary: value },
  { id: "outCustomerFee", bytes: 3, numeric: true },
  { id: "outUnpostedCount", bytes: 2, numeric: true },
  { id: "outCdwAmount", bytes: 6, numeric: true },
  { id: "outBankNumber", bytes: 3, numeric: true },
  { id: "outCardAccount", bytes: 16, numeric: true, classification: "sensitive" },
  {
    id: "outTransactionAccount",
    bytes: 16,
    numeric: true,
    classification: "sensitive",
  },
  {
    id: "outDestinationBank",
    bytes: 3,
    numeric: true,
    numericPadding: "space",
  },
  {
    id: "outDestinationAccount",
    bytes: 16,
    numeric: true,
    numericPadding: "space",
    classification: "sensitive",
  },
  { id: "outTransactionAmount", bytes: 8, numeric: true },
  { id: "outDispenseCount1Low", bytes: 2, numeric: true },
  { id: "outDispenseCount2Low", bytes: 2, numeric: true },
  { id: "outDispenseCount3Low", bytes: 2, numeric: true },
  { id: "outDispenseCount4Low", bytes: 2, numeric: true },
  { id: "outOffsetIncrement", bytes: 4 },
  { id: "outBalance11Sign", bytes: 1 },
  { id: "outBalance11Amount", bytes: 13, numeric: true },
  { id: "outBalance12Sign", bytes: 1 },
  { id: "outBalance12Amount", bytes: 13, numeric: true },
  { id: "outBalance13Sign", bytes: 1 },
  { id: "outBalance13Amount", bytes: 13, numeric: true },
  { id: "outBalance14Sign", bytes: 1 },
  { id: "outBalance14Amount", bytes: 13, numeric: true },
  { id: "outWriteTrack3", bytes: 1 },
  { id: "outTrack3", bytes: 104, classification: "secret" },
  { id: "outRetainCard", bytes: 1, summary: value },
  { id: "outMacDate", bytes: 6, numeric: true },
  { id: "outMac", bytes: 8, classification: "secret" },
  { id: "outStan", bytes: 7 },
  { id: "outAdvertisement", bytes: 16 },
  { id: "outDispenseCount1High", bytes: 2, numeric: true },
  { id: "outDispenseCount2High", bytes: 2, numeric: true },
  { id: "outDispenseCount3High", bytes: 2, numeric: true },
  { id: "outDispenseCount4High", bytes: 2, numeric: true },
  { id: "outDispenseCount5", bytes: 4, numeric: true },
  { id: "outDispenseCount6", bytes: 4, numeric: true },
  { id: "outDispenseCount7", bytes: 4, numeric: true },
  { id: "outDispenseCount8", bytes: 4, numeric: true },
  { id: "outBalanceCurrency", bytes: 3 },
  { id: "outFeeCurrency", bytes: 3 },
] as const satisfies readonly WireField[];

const iwfAdditionalResponseFields = [
  { id: "outTransferOutCount", bytes: 2, numeric: true },
  { id: "outTransferInCount", bytes: 2, numeric: true },
  { id: "outAccountCount", bytes: 1, numeric: true },
  { id: "outAccounts", bytes: 440, classification: "sensitive" },
  { id: "outUnitNumber", bytes: 11 },
  { id: "outSelfService", bytes: 1, numeric: true },
] as const satisfies readonly WireField[];

export const bspWithdrawalResponseLayout = [
  ...responseHeaderLayout,
  ...iwdResponseBodyLayout,
] as const satisfies readonly WireField[];

export const bspWithdrawalCompletionResponseLayout = [
  ...responseHeaderLayout,
  iwdResponseBodyLayout[0],
  iwdResponseBodyLayout[1],
  iwdResponseBodyLayout[2],
  iwdResponseBodyLayout[3],
  iwdResponseBodyLayout[4],
  iwdResponseBodyLayout[5],
  iwdResponseBodyLayout[14],
  ...iwfAdditionalResponseFields.slice(0, 4),
  iwdResponseBodyLayout[23],
  iwdResponseBodyLayout[24],
  iwdResponseBodyLayout[25],
  ...iwfAdditionalResponseFields.slice(4),
] as const satisfies readonly WireField[];

export type BspWithdrawalIciFieldId = (typeof bspWithdrawalIciLayout)[number]["id"];

const fieldDefinitions = [
  ...requestHeaderLayout,
  ...bspWithdrawalIciLayout,
  ...requestTailLayout,
  ...bspWithdrawalResponseLayout,
  ...iwfAdditionalResponseFields,
].map((field) =>
  bspField(field.id, field.bytes, {
    ...("classification" in field ? { classification: field.classification } : {}),
    ...("numeric" in field ? { numeric: field.numeric } : {}),
    ...("numericPadding" in field ? { numericPadding: field.numericPadding } : {}),
    ...("summary" in field ? { summary: field.summary } : {}),
  }),
);

const usesLayout = (layout: readonly WireField[]) =>
  layout.map(({ id }) => ({ fieldId: id, kind: "field" as const }));

const requestPrefix = [...usesLayout(requestHeaderLayout), ...usesLayout(bspWithdrawalIciLayout)];
const requestSuffix = usesLayout(requestTailLayout.slice(3));
const responseFields = usesLayout(bspWithdrawalResponseLayout);
const completionResponseFields = usesLayout(bspWithdrawalCompletionResponseLayout);

export const BSP_V243_WITHDRAWAL_PROFILE_ID = "taiwan.bsp.v243.withdrawal";
export const BSP_V243_WITHDRAWAL_PROFILE_VERSION = "2.43";
export const BSP_V243_IWD_RESPONSE_BYTES = 373;
export const BSP_V243_IWF_RESPONSE_BYTES = 656;

export const bspV243WithdrawalProfile: HostMessageProfile = {
  codecId: "fixed-field",
  fieldDefinitions,
  id: BSP_V243_WITHDRAWAL_PROFILE_ID,
  maxMessageBytes: 720,
  messages: [
    {
      direction: "request",
      fields: [
        ...requestPrefix,
        ...usesLayout(requestTailLayout.slice(0, 2)),
        ...requestSuffix,
      ],
      id: "iwd.request",
    },
    {
      direction: "response",
      fields: responseFields,
      id: "iwd.response",
    },
    {
      direction: "request",
      fields: [
        ...requestPrefix,
        ...usesLayout(requestTailLayout.slice(2, 3)),
        ...requestSuffix,
      ],
      id: "iwf.request",
    },
    {
      direction: "response",
      fields: completionResponseFields,
      id: "iwf.response",
    },
  ],
  version: BSP_V243_WITHDRAWAL_PROFILE_VERSION,
};
