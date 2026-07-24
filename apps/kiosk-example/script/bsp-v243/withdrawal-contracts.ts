import type {
  WithdrawalHostPostingPort,
  WithdrawalOutcome,
} from "@tripley-kit/web-container-withdrawal-orchestration";

import type { BspWithdrawalIciFieldId } from "./withdrawal-profile";

export type BspWithdrawalAuthorizeInput =
  Parameters<WithdrawalHostPostingPort["authorize"]>[0];
export type BspWithdrawalCompleteInput =
  Parameters<NonNullable<WithdrawalHostPostingPort["complete"]>>[0];

export interface BspV243AtmRequestHeader {
  readonly versionMarker: string;
  readonly versionDate: string;
  readonly atmId: string;
  readonly businessDate: string;
  readonly systemDate: string;
  readonly sequence: string;
  readonly transmissionArea?: string | undefined;
  readonly deviceStatus?: string | undefined;
  readonly serviceStatus?: string | undefined;
  readonly mode?: string | undefined;
  readonly depositMode?: string | undefined;
  readonly notesFiveToEight?: string | undefined;
}

export type BspV243IciFields = Partial<
  Readonly<Record<BspWithdrawalIciFieldId, string>>
>;

export interface BspV243IwdContext {
  readonly header: BspV243AtmRequestHeader;
  readonly ici: BspV243IciFields;
}

export interface BspV243IwfContext extends BspV243IwdContext {
  readonly originalAtmSystemDate: string;
  readonly originalAtmSequence: string;
}

export interface BspV243WithdrawalContextProvider {
  authorization(input: BspWithdrawalAuthorizeInput): Promise<BspV243IwdContext>;
}

export interface BspV243CompletionReason {
  readonly kind: string;
  readonly number: string;
}

export interface BspV243CompletionReasonPolicy {
  map(outcome: WithdrawalOutcome): BspV243CompletionReason;
}

export interface BspV243CompletionOptions {
  readonly context: (
    input: BspWithdrawalCompleteInput,
  ) => Promise<BspV243IwfContext>;
  readonly reasonPolicy: BspV243CompletionReasonPolicy;
  readonly deliveryPolicyId?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface BspV243WithdrawalHostOptions {
  readonly contexts: BspV243WithdrawalContextProvider;
  readonly transportId: string;
  readonly channel?: string | undefined;
  readonly authorizationDeliveryPolicyId?: string | undefined;
  readonly authorizationTimeoutMs?: number | undefined;
  readonly acceptedRejectCodes?: readonly string[] | undefined;
  readonly completion?: BspV243CompletionOptions | undefined;
}

export interface BspV243AuthorizationExchangeRequest {
  readonly input: BspWithdrawalAuthorizeInput;
  readonly context: BspV243IwdContext;
}

export interface BspV243CompletionExchangeRequest {
  readonly input: BspWithdrawalCompleteInput;
  readonly context: BspV243IwfContext;
}

