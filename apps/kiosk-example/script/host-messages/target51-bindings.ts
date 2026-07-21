import type { HostMessageProfile } from "@tripley-kit/web-container-host-message";
import type { HostMessageBinding } from "@tripley-kit/web-container-kiosk-host-integration";
import type { WithdrawalHostPostingPort } from "@tripley-kit/web-container-withdrawal-orchestration";

type AuthorizationInput = Parameters<WithdrawalHostPostingPort["authorize"]>[0];
type AuthorizationResult = Awaited<ReturnType<WithdrawalHostPostingPort["authorize"]>>;

export const target51HostProfile: HostMessageProfile = {
  codecId: "iso8583",
  fieldDefinitions: [
    {
      id: "processingCode",
      dataElement: 3,
      dataClassification: "internal",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 6 },
    },
    {
      id: "amount",
      dataElement: 4,
      dataClassification: "internal",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 12 },
    },
    {
      id: "stan",
      dataElement: 11,
      dataClassification: "internal",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 6 },
    },
    {
      id: "authorizationReference",
      dataElement: 38,
      dataClassification: "internal",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 6 },
    },
    {
      id: "responseCode",
      dataElement: 39,
      dataClassification: "public",
      encoding: { kind: "ascii" },
      length: { kind: "fixed", bytes: 2 },
    },
  ],
  id: "kiosk-example.target51.iso8583",
  maxMessageBytes: 256,
  messages: [
    {
      direction: "request",
      fields: [
        { fieldId: "processingCode", kind: "field", presence: "required" },
        { fieldId: "amount", kind: "field", presence: "required" },
        { fieldId: "stan", kind: "field", presence: "required" },
      ],
      id: "withdrawal.authorization.request",
      mti: "0200",
    },
    {
      direction: "response",
      fields: [
        { fieldId: "authorizationReference", kind: "field", presence: "required" },
        { fieldId: "responseCode", kind: "field", presence: "required" },
      ],
      id: "withdrawal.authorization.response",
      mti: "0210",
    },
  ],
  version: "1",
};

export const withdrawalAuthorizationBinding: HostMessageBinding<
  AuthorizationInput,
  AuthorizationResult
> = {
  channel: "bank.primary",
  deliveryPolicyId: "authorization.standard",
  id: "example.withdrawal.authorization",
  mapResponse: (fields) => ({
    authorizationReference: fields.authorizationReference as string,
    reasonCode: fields.responseCode as string,
    status: fields.responseCode === "00" ? "approved" : "declined",
  }),
  messageType: "withdrawal.authorization",
  projectRequest: (input) => ({
    amount: String(input.amount.minorUnits).padStart(12, "0"),
    processingCode: "010000",
    stan: String(input.safeMetadata?.stan ?? "000001"),
  }),
  request: {
    messageId: "withdrawal.authorization.request",
    profileId: target51HostProfile.id,
    profileVersion: target51HostProfile.version,
  },
  response: {
    messageId: "withdrawal.authorization.response",
    profileId: target51HostProfile.id,
    profileVersion: target51HostProfile.version,
  },
  summarizeRequest: (input) => ({
    amountMinorUnits: input.amount.minorUnits,
    currency: input.amount.currency,
    entryMode: input.entryMode,
    operationType: "withdrawal",
  }),
  timeoutMs: 15_000,
  transportId: "native.tcp.primary",
  version: "1",
};
