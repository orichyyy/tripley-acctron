import { createHostMessageService } from "@tripley-kit/web-container-host-message";
import { createLengthPrefixFrameCodec } from "@tripley-kit/web-container-kiosk-host-native-channel";
import type {
  HostSessionPolicy,
  HostSessionTransportPort,
} from "@tripley-kit/web-container-kiosk-host-session";
import { HostSessionSupervisor } from "@tripley-kit/web-container-kiosk-host-session";

import type {
  BspV243HostControlContribution,
  BspV243PendingResponseInput,
  BspV243SessionProfile,
  BspV243TerminalStateProvider,
} from "./contracts";
import { BspV243HostControlRegistry } from "./control-registry";
import { createBspV243OexProtocol } from "./oex";
import { bspV243Profile } from "./profile";
import { createBspV243FrameRouter } from "./router";
import { bspV243WithdrawalProfile } from "./withdrawal-profile";

export interface CreateBspV243SessionProfileOptions {
  readonly terminalState: BspV243TerminalStateProvider;
  readonly controls?: readonly BspV243HostControlContribution[] | undefined;
  readonly channel?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly acceptedRejectCodes?: readonly string[] | undefined;
  resolvePendingResponse?(
    input: BspV243PendingResponseInput,
  ): { readonly responseId?: string | undefined } | undefined;
}

export const createBspV243SessionProfile = (
  options: CreateBspV243SessionProfileOptions,
): BspV243SessionProfile => {
  const { service: messages } = createHostMessageService({
    profiles: [bspV243Profile, bspV243WithdrawalProfile],
  });
  const controls = new BspV243HostControlRegistry(messages);
  for (const contribution of options.controls ?? []) controls.register(contribution);
  const inbound = controls.createInboundRegistry();
  return {
    frame: createLengthPrefixFrameCodec({
      fixedHeader: Uint8Array.of(0x0f, 0x0f, 0x0f),
      lengthBytes: 3,
      lengthEncoding: "bcd",
      lengthIncludesFixedHeader: true,
      lengthIncludesLengthField: true,
      maxFrameBytes: 2_048,
    }),
    inbound,
    messages,
    protocol: createBspV243OexProtocol({
      acceptedRejectCodes: options.acceptedRejectCodes,
      channel: options.channel,
      messages,
      terminalState: options.terminalState,
      timeoutMs: options.timeoutMs,
    }),
    routeFrame: createBspV243FrameRouter({
      controls,
      ...(options.resolvePendingResponse
        ? { resolvePendingResponse: options.resolvePendingResponse }
        : {}),
    }),
  };
};

export const createBspV243SessionSupervisor = (
  id: string,
  transport: HostSessionTransportPort,
  profile: BspV243SessionProfile,
  policy: HostSessionPolicy,
) => new HostSessionSupervisor({ id, policy, protocol: profile.protocol, transport });
