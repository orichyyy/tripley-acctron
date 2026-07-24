import type { HostMessageService } from "@tripley-kit/web-container-host-message";
import type {
  HostFrameCodec,
  HostInboundMessageRegistry,
  PersistentHostFrameRouteInput,
} from "@tripley-kit/web-container-kiosk-host-native-channel";
import type { HostSessionProtocol } from "@tripley-kit/web-container-kiosk-host-session";

export interface BspV243TerminalSnapshot {
  readonly atmId: string;
  readonly versionDate: string;
  readonly businessDate: string;
  readonly systemDate: string;
  readonly sequence: string;
  readonly transmissionArea?: string | undefined;
  readonly deviceStatus?: string | undefined;
  readonly serviceStatus?: string | undefined;
  readonly mode?: string | undefined;
  readonly depositMode?: string | undefined;
  readonly notesFiveToEight?: string | undefined;
  readonly statusReason?: string | undefined;
  readonly hostTransactionSequence?: string | undefined;
  readonly stoppedDate?: string | undefined;
  readonly stoppedTime?: string | undefined;
  readonly restoredDate?: string | undefined;
  readonly restoredTime?: string | undefined;
  readonly stopReason?: string | undefined;
  readonly treat051AsOwnCard?: string | undefined;
  readonly messageType?: string | undefined;
  readonly country?: string | undefined;
  readonly programVersion?: string | undefined;
  readonly advertisementVersion?: string | undefined;
  readonly cassetteStatusArea?: string | undefined;
  readonly secondaryDeviceStatus?: string | undefined;
}

export type BspV243TerminalStateProvider = () =>
  | BspV243TerminalSnapshot
  | Promise<BspV243TerminalSnapshot>;

export interface BspV243HostControlMessage {
  readonly code: string;
  readonly date: string;
  readonly time: string;
  readonly atmId: string;
  readonly mode: string;
  readonly businessDate: string;
  readonly depositMode: string;
  readonly systemDate: string;
  readonly sequence: string;
  readonly body: string;
}

export interface BspV243HostControlContext {
  respond(
    payload: Uint8Array,
  ): Promise<
    | { readonly status: "sent" }
    | { readonly status: "notSent"; readonly errorCode: string }
    | { readonly status: "unknown"; readonly errorCode: string }
  >;
}

export interface BspV243HostControlContribution {
  readonly id: string;
  readonly code: string;
  readonly type: string;
  handle(
    message: BspV243HostControlMessage,
    context: BspV243HostControlContext,
  ): Promise<void> | void;
}

export interface BspV243PendingResponseInput {
  readonly code: string;
  readonly payload: Uint8Array;
  readonly pending: NonNullable<PersistentHostFrameRouteInput["pending"]>;
}

export interface BspV243SessionProfile {
  readonly messages: HostMessageService;
  readonly frame: HostFrameCodec;
  readonly inbound: HostInboundMessageRegistry;
  readonly protocol: HostSessionProtocol;
  routeFrame(
    input: PersistentHostFrameRouteInput,
  ):
    | { readonly kind: "response"; readonly responseId?: string | undefined }
    | { readonly kind: "inbound"; readonly type: string; readonly messageId?: string | undefined }
    | { readonly kind: "ignore"; readonly reason: string };
}
