import type {
  XfsBcrReadRequest,
  XfsCdmCapabilities,
  XfsCdmCashUnitInfo,
  XfsCdmDenominateRequest,
  XfsCdmDenominationResult,
  XfsCdmDispenseRequest,
  XfsCdmPositionRequest,
  XfsCdmPresentStatus,
  XfsCdmRequest,
  XfsCdmRetractRequest,
  XfsCommandLease,
  XfsCommandLeaseNextRequest,
  XfsCommandLeaseReleaseRequest,
  XfsCommandLeaseRequest,
  XfsCommandLeaseTransitionRequest,
  XfsIdcEjectCardRequest,
  XfsIdcReadRawDataRequest,
  XfsIdcRequest,
  XfsOpenRequest,
  XfsRegisterRequest,
  XfsPinBlockRequest,
  XfsPinCryptRequest,
  XfsPinGetDataRequest,
  XfsPinGetPinRequest,
  XfsPinImportKeyRequest,
  XfsStartupRequest,
} from "@tripley-kit/xfs-client";
import type { DataClassification } from "@tripley-kit/web-container-device-core";
import type { CashDeliveryDependencies } from "./cash-contracts";
import type { XfsDeviceModuleAdapterRegistry } from "./module-adapters";
import type { CashRecoveryDeviceRegistrationPort } from "./recovery-contracts";

export const xfsDeviceServicePackageName = "@tripley-kit/web-container-xfs-device-service";

export type XfsSupportedModule = "idc" | "pin" | "bcr" | "cdm" | (string & {});
export type XfsRequiredModule = "manager" | XfsSupportedModule;

export interface XfsDeviceServiceConfig {
  readonly url: string;
  readonly authToken?: string | undefined;
  readonly appId?: string | undefined;
  readonly ownerInstanceId?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly startup?: XfsStartupConfig | undefined;
  readonly logicalServices: readonly XfsLogicalServiceConfig[];
}

export interface XfsStartupConfig {
  readonly enabled?: boolean | undefined;
  readonly lowVersion?: number | undefined;
  readonly highVersion?: number | undefined;
  readonly dllDirectory?: string | undefined;
}

export interface XfsLogicalServiceConfig {
  readonly deviceId: string;
  readonly logicalName: string;
  readonly module: XfsSupportedModule;
  readonly capabilities: readonly string[];
  readonly dataClassification?: DataClassification | undefined;
  readonly protectionPolicyProfileId?: string | undefined;
  readonly resourceGroup?: string | undefined;
  readonly idc?: XfsIdcOperationalPolicy | undefined;
  readonly cdm?: XfsCdmOperationalPolicy | undefined;
}

export interface XfsIdcOperationalPolicy {
  readonly resetBeforeRead?: boolean | undefined;
}

export interface XfsCdmOperationalPolicy {
  readonly policyVersion: string;
  readonly configurationRevision: string;
  readonly delayedPresentation?: boolean | undefined;
  readonly outputPosition?: number | undefined;
  readonly retractArea?: number | undefined;
  readonly retractIndex?: number | undefined;
  readonly tellerId?: number | undefined;
  readonly mixNumber?: number | undefined;
  readonly planTtlMs?: number | undefined;
  readonly commandLeaseTtlMs?: number | undefined;
  readonly statusPollMs?: number | undefined;
  readonly resourceGroup?: string | undefined;
  readonly protectionPolicyProfileId?: string | undefined;
}

export interface XfsHealthCheck {
  readonly id: string;
  check(): Promise<XfsHealthCheckResult>;
}

export interface XfsHealthCheckResult {
  readonly id: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly message?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface XfsDeviceOperationContext {
  readonly operationId: string;
  readonly signal?: AbortSignal | undefined;
}

export interface XfsNativeResultLike {
  readonly hResult?: number | undefined;
  readonly hresult?: number | undefined;
  readonly rawFields?: Record<string, string> | undefined;
}

export interface XfsSessionLike {
  readonly id: string;
}

export interface XfsOpenResultLike {
  readonly native?: XfsNativeResultLike | undefined;
  readonly session: XfsSessionLike;
}

export interface XfsManagerClientLike {
  startup(request: XfsStartupRequest): Promise<unknown>;
  open(request: XfsOpenRequest): Promise<XfsOpenResultLike>;
  close(request: { readonly sessionId: string }): Promise<unknown>;
  registerEvents?(request: XfsRegisterRequest): Promise<unknown>;
  cancelAsyncRequest(request: {
    readonly sessionId: string;
    readonly requestId: number;
  }): Promise<unknown>;
}

export interface XfsIdcClientLike {
  getStatus(request: XfsSessionRequestLike): Promise<XfsNativeEnvelopeLike>;
  readRawData(request: XfsIdcReadRawDataRequest): Promise<XfsNativeEnvelopeLike>;
  reset?(request: XfsSessionRequestLike): Promise<XfsNativeEnvelopeLike>;
  ejectCard?(request: XfsIdcEjectCardRequest): Promise<XfsNativeEnvelopeLike>;
  retainCard?(request: XfsIdcRequest): Promise<XfsNativeEnvelopeLike>;
  subscribeEvent?(handler: (event: XfsIdcEventLike) => void | Promise<void>): unknown;
}

export interface XfsIdcEventLike {
  readonly data?: { readonly kind?: string | undefined } | undefined;
}

export interface XfsPinClientLike {
  crypt?(request: XfsPinCryptRequest): Promise<XfsNativeEnvelopeLike>;
  getStatus(request: XfsSessionRequestLike): Promise<XfsNativeEnvelopeLike>;
  getData(request: XfsPinGetDataRequest): Promise<XfsNativeEnvelopeLike>;
  getPin(request: XfsPinGetPinRequest): Promise<XfsNativeEnvelopeLike>;
  getPinblock(request: XfsPinBlockRequest): Promise<XfsNativeEnvelopeLike>;
  importKey?(request: XfsPinImportKeyRequest): Promise<XfsNativeEnvelopeLike>;
  reset?(request: XfsSessionRequestLike): Promise<XfsNativeEnvelopeLike>;
  subscribeEvent?(
    handler: (event: XfsPinEventLike) => void | Promise<void>,
  ): XfsEventSubscriptionLike;
}

export interface XfsPinEventLike {
  readonly data?: {
    readonly kind?: string | undefined;
    readonly value?: unknown;
  } | undefined;
}

export interface XfsBcrClientLike {
  getStatus(request: XfsSessionRequestLike): Promise<XfsNativeEnvelopeLike>;
  read(request: XfsBcrReadRequest): Promise<XfsNativeEnvelopeLike>;
  reset?(request: XfsSessionRequestLike): Promise<XfsNativeEnvelopeLike>;
}

export interface XfsCdmClientLike {
  getStatus(request: XfsCdmRequest): Promise<XfsCdmStatusLike>;
  getCapabilities(request: XfsCdmRequest): Promise<XfsCdmCapabilities>;
  getCashUnitInfo(request: XfsCdmRequest): Promise<XfsCdmCashUnitInfo>;
  getPresentStatus(request: XfsCdmPositionRequest): Promise<XfsCdmPresentStatus>;
  denominate(request: XfsCdmDenominateRequest): Promise<XfsCdmDenominationResult>;
  dispense(request: XfsCdmDispenseRequest): Promise<XfsCdmDenominationResult>;
  present(request: XfsCdmPositionRequest): Promise<XfsNativeEnvelopeLike>;
  retract(request: XfsCdmRetractRequest): Promise<XfsNativeEnvelopeLike>;
  subscribeEvent?(
    handler: (event: XfsCdmEventLike) => void | Promise<void>,
  ): XfsEventSubscriptionLike;
}

export interface XfsCdmStatusLike extends XfsNativeEnvelopeLike {
  readonly fwIntermediateStacker?: number | undefined;
  readonly positions?: readonly {
    readonly fwPosition: number;
    readonly fwPositionStatus: number;
  }[] | undefined;
}

export interface XfsCdmEventLike {
  readonly data?: {
    readonly kind?: string | undefined;
    readonly value?: unknown;
  } | undefined;
}

export interface XfsEventSubscriptionLike {
  unsubscribe(): void;
}

export interface XfsCommandLeaseClientLike {
  getHostEpoch(): Promise<string>;
  acquire(request: XfsCommandLeaseRequest): Promise<XfsCommandLease>;
  acquireNext(request: XfsCommandLeaseNextRequest): Promise<XfsCommandLease>;
  release(request: XfsCommandLeaseReleaseRequest): Promise<void>;
  status(logicalService: string): Promise<XfsCommandLease | null>;
  transition(request: XfsCommandLeaseTransitionRequest): Promise<XfsCommandLease>;
}

export interface XfsRuntimeClientLike {
  readonly manager: XfsManagerClientLike;
  readonly idc: XfsIdcClientLike;
  readonly pin: XfsPinClientLike;
  readonly bcr: XfsBcrClientLike;
  readonly cdm?: XfsCdmClientLike | undefined;
  readonly commandLeases?: XfsCommandLeaseClientLike | undefined;
  connect(): Promise<void>;
  dispose(): Promise<void>;
}

export interface XfsSessionRequestLike {
  readonly sessionId: string;
  readonly timeoutMs: number;
}

export interface XfsNativeEnvelopeLike {
  readonly native?: XfsNativeResultLike | undefined;
  readonly hResult?: number | undefined;
  readonly hresult?: number | undefined;
  readonly data?: unknown;
  readonly encryptedPinBlock?: unknown;
  readonly keys?: unknown;
  readonly outputs?: unknown;
  readonly value?: unknown;
  readonly fwDevice?: number | undefined;
  readonly fwMedia?: number | undefined;
}

export type XfsRuntimeClientFactory = (options: {
  readonly url: string;
  readonly authToken?: string | undefined;
  readonly requiredModules: readonly XfsRequiredModule[];
}) => XfsRuntimeClientLike;

export interface XfsDeviceServiceOptions {
  readonly client?: XfsRuntimeClientLike | undefined;
  readonly clientFactory?: XfsRuntimeClientFactory | undefined;
  readonly moduleAdapters?: XfsDeviceModuleAdapterRegistry | undefined;
  readonly cash?: CashDeliveryDependencies | undefined;
  readonly cashRecoveryDevices?: CashRecoveryDeviceRegistrationPort | undefined;
}

export interface XfsCardReadOptions {
  readonly dataSources?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface XfsCardReadResult {
  readonly kind: "card";
  readonly safeSummary: Record<string, unknown>;
  readonly raw?: unknown;
}

export interface XfsCardEjectOptions {
  readonly timeoutMs?: number | undefined;
  readonly position?: "exit" | "transport" | undefined;
}

export interface XfsCardRetainOptions {
  readonly timeoutMs?: number | undefined;
}

export type XfsCardMediaState =
  | "notPresent"
  | "presented"
  | "inside"
  | "jammed"
  | "unsupported"
  | "unknown";

export interface XfsCardMediaStatus {
  readonly state: XfsCardMediaState;
  readonly safeSummary: Record<string, unknown>;
}

export interface XfsWaitForCardTakenOptions {
  readonly timeoutMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
}

export interface XfsCardTakenResult {
  readonly taken: boolean;
  readonly status: XfsCardMediaStatus;
  readonly safeSummary: Record<string, unknown>;
}
