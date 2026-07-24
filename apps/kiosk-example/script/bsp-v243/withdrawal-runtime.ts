import type { Condition } from "@tripley-kit/web-container-condition-engine";
import type { HealthCheck } from "@tripley-kit/web-container-kiosk-base";
import {
  type DurableHostDeliveryBridge,
  DurableHostMessageExchange,
  HostMessageBindingRegistry,
  HostMessageTransportAdapter,
  HostWireTransportRegistry,
} from "@tripley-kit/web-container-kiosk-host-integration";
import type {
  HostTransportPort,
} from "@tripley-kit/web-container-kiosk-host-delivery";
import type {
  NativeTcpApi,
  PersistentNativeHostRuntime,
} from "@tripley-kit/web-container-kiosk-host-native-channel";
import {
  type HostSessionPolicy,
  type HostSessionSupervisorPort,
  createHostSessionHealthCheck,
  createHostSessionReadyCondition,
} from "@tripley-kit/web-container-kiosk-host-session";
import type { WithdrawalHostPostingPort } from "@tripley-kit/web-container-withdrawal-orchestration";

import { createExamplePersistentHostChannel } from "../persistent-host-channel";
import {
  type BspV243HostControlContribution,
  type BspV243SessionProfile,
  type BspV243TerminalStateProvider,
} from "./contracts";
import {
  createBspV243SessionProfile,
  createBspV243SessionSupervisor,
} from "./composition";
import type { BspV243WithdrawalHostOptions } from "./withdrawal-contracts";
import {
  type BspV243WithdrawalHostContribution,
  createBspV243WithdrawalHostContribution,
} from "./withdrawal-host";
import { resolveBspV243WithdrawalResponse } from "./withdrawal-router";

export const BSP_V243_PERSISTENT_TRANSPORT_ID = "native.tcp.persistent";

export type BspV243WithdrawalRuntimeHostOptions = Omit<
  BspV243WithdrawalHostOptions,
  "transportId"
>;

export interface BspV243WithdrawalRuntimeOptions {
  readonly tcp: NativeTcpApi;
  readonly host: string;
  readonly port: number;
  readonly terminalState: BspV243TerminalStateProvider;
  readonly hostOptions: BspV243WithdrawalRuntimeHostOptions;
  readonly controls?: readonly BspV243HostControlContribution[] | undefined;
  readonly sessionPolicy?: HostSessionPolicy | undefined;
  createDelivery(transport: HostTransportPort): DurableHostDeliveryBridge;
}

export interface BspV243WithdrawalHostRuntime {
  readonly profile: BspV243SessionProfile;
  readonly contribution: BspV243WithdrawalHostContribution;
  readonly bindings: HostMessageBindingRegistry;
  readonly transports: HostWireTransportRegistry;
  readonly channel: PersistentNativeHostRuntime;
  readonly supervisor: HostSessionSupervisorPort;
  readonly readyCondition: Condition;
  readonly healthCheck: HealthCheck;
  readonly host: WithdrawalHostPostingPort;
  start(): Promise<void>;
  dispose(): Promise<void>;
}

export const createBspV243WithdrawalHostRuntime = (
  options: BspV243WithdrawalRuntimeOptions,
): BspV243WithdrawalHostRuntime => {
  const profile = createBspV243SessionProfile({
    controls: options.controls,
    resolvePendingResponse: resolveBspV243WithdrawalResponse,
    terminalState: options.terminalState,
  });
  const contribution = createBspV243WithdrawalHostContribution({
    ...options.hostOptions,
    transportId: BSP_V243_PERSISTENT_TRANSPORT_ID,
  });
  const bindings = contribution.register(new HostMessageBindingRegistry());
  const transports = new HostWireTransportRegistry();
  const channel = createExamplePersistentHostChannel(options.tcp, transports, {
    frame: profile.frame,
    host: options.host,
    inbound: profile.inbound,
    port: options.port,
    routeFrame: profile.routeFrame,
  });
  const session = channel.sessions[0];
  if (!session) throw new Error("BSP persistent host session was not created");
  const messageTransport = new HostMessageTransportAdapter({
    bindings,
    messages: profile.messages,
    transports,
  });
  const delivery = options.createDelivery(messageTransport);
  const exchange = new DurableHostMessageExchange({
    bindings,
    delivery,
    messages: profile.messages,
  });
  const supervisor = createBspV243SessionSupervisor(
    "taiwan.bsp.v243.primary",
    session,
    profile,
    options.sessionPolicy ?? defaultSessionPolicy,
  );

  return {
    bindings,
    channel,
    contribution,
    healthCheck: createHostSessionHealthCheck(supervisor),
    host: contribution.createPostingPort(exchange),
    profile,
    readyCondition: createHostSessionReadyCondition(supervisor),
    supervisor,
    transports,
    start: () => supervisor.start(),
    dispose: () => supervisor.dispose(),
  };
};

const defaultSessionPolicy: HostSessionPolicy = Object.freeze({
  establishRetry: {
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    multiplier: 2,
  },
  establishTimeoutMs: 15_000,
  shutdownTimeoutMs: 5_000,
});

