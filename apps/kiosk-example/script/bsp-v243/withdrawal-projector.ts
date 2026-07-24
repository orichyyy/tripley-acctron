import type { HostFieldSet } from "@tripley-kit/web-container-host-message";

import type {
  BspV243CompletionReason,
  BspV243IwdContext,
  BspV243IwfContext,
} from "./withdrawal-contracts";
import { bspWithdrawalIciLayout } from "./withdrawal-profile";

const blankIci = (): Record<string, string> =>
  Object.fromEntries(bspWithdrawalIciLayout.map(({ id }) => [id, ""]));

const projectBase = (
  transactionCode: "IWD" | "IWF",
  context: BspV243IwdContext,
): Record<string, string> => ({
  inTransmissionArea: context.header.transmissionArea ?? "",
  inTransactionCode: transactionCode,
  inVersionMarker: context.header.versionMarker,
  inVersionDate: context.header.versionDate,
  inAtmId: context.header.atmId,
  inDeviceStatus: context.header.deviceStatus ?? "",
  inServiceStatus: context.header.serviceStatus ?? "",
  inMode: context.header.mode ?? "",
  inBusinessDate: context.header.businessDate,
  inDepositMode: context.header.depositMode ?? "",
  inSystemDate: context.header.systemDate,
  inSequence: context.header.sequence,
  ...blankIci(),
  ...context.ici,
  inNotesFiveToEight: context.header.notesFiveToEight ?? "",
  inTailFiller: "",
});

export const projectBspV243IwdRequest = (
  context: BspV243IwdContext,
): HostFieldSet => ({
  ...projectBase("IWD", context),
  inOriginalCenterSequence: "0000000",
  inOriginalAtmSystemDate: "00000000",
  inOriginalAtmSequence: "00000000",
  inExceptionKind: "",
  inExceptionNumber: "000",
  inIwdCardAccountNote: "",
  inIwdBodyFiller: "",
});

export const projectBspV243IwfRequest = (
  context: BspV243IwfContext,
  authorizationReference: string,
  reason: BspV243CompletionReason,
): HostFieldSet => {
  if (!authorizationReference.trim()) {
    throw new Error("BSP IWF requires the original IWD center transaction sequence");
  }
  return {
    ...projectBase("IWF", context),
    inOriginalCenterSequence: authorizationReference,
    inOriginalAtmSystemDate: context.originalAtmSystemDate,
    inOriginalAtmSequence: context.originalAtmSequence,
    inExceptionKind: reason.kind,
    inExceptionNumber: reason.number,
    inIwfBodyFiller: "",
  };
};

