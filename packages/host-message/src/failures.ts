import type { HostMessageFailure, HostMessageReference } from "./contracts";

export type FailureDetails = Omit<HostMessageFailure, "category" | "code" | "message">;

export const hostMessageFailure = (
  code: string,
  message: string,
  details: FailureDetails = {},
): HostMessageFailure => ({ category: "protocol", code, message, ...details });

export const referenceDetails = (reference: HostMessageReference): FailureDetails => ({
  messageId: reference.messageId,
  profileId: reference.profileId,
  profileVersion: reference.profileVersion,
});

export const addFailureDetails = (
  failure: HostMessageFailure,
  details: FailureDetails,
): HostMessageFailure => ({ ...failure, ...details });

const partialCodes = new Set([
  "hostMessage.message.truncated",
  "hostMessage.field.decodeFailed",
  "hostMessage.field.validationFailed",
  "hostMessage.field.invalidLengthPrefix",
]);

export const canReturnPartial = (failure: HostMessageFailure): boolean =>
  partialCodes.has(failure.code);
