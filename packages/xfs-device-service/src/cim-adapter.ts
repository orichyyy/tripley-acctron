import { CashAcceptanceService, type CashAcceptanceServiceDependencies } from "./cash-acceptance";
import type { CashNoteCount, CimCashInClient } from "./cash-acceptance-contracts";
import type { XfsDeviceModuleAdapter } from "./module-adapters";
import type { TripleyXfsClient } from "@tripley-kit/xfs-client";
import { normalizeCimCashUnits } from "./cim-cash-unit-evidence";

declare module "./types" {
  interface XfsRuntimeClientLike {
    readonly cim?: XfsCimRpcClient | undefined;
  }
}

export interface CimModuleClientFacade {
  readonly cim: CimCashInClient;
}

export type XfsCimRpcClient = Pick<TripleyXfsClient["cim"],
  "cashInStart" | "cashIn" | "getCashInStatus" | "cashInEnd" | "cashInRollback" |
  "getCapabilities" | "getCashUnitInfo" | "openShutter" | "closeShutter" | "retract">;

export interface CimInventoryCapture {
  readonly revision: string;
  readonly capturedAt: string;
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface CimRefusedMediaRequest {
  readonly outputPosition: number;
  readonly takeTimeoutMs: number;
  readonly retractTimeoutMs: number;
  readonly retractArea?: number | undefined;
  readonly retractIndex?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface CimRefusedMediaResult {
  readonly status: "taken" | "retracted" | "cancelled" | "unknown";
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface CimModuleAdapterContext {
  readonly client: CimModuleClientFacade;
  readonly cashAcceptance: Omit<CashAcceptanceServiceDependencies, "client">;
}

export interface CimModuleContribution {
  readonly module: "cim";
  readonly cashAcceptance: CashAcceptanceService;
}

export interface CimCashAcceptanceDevicePort {
  createService(dependencies: Omit<CashAcceptanceServiceDependencies, "client">): CashAcceptanceService;
  captureInventory(): Promise<CimInventoryCapture>;
  resolveRefusedMedia(request: CimRefusedMediaRequest): Promise<CimRefusedMediaResult>;
}

export function createCimModuleContribution(context: CimModuleAdapterContext): CimModuleContribution {
  if (!context.client.cim) throw new Error("The XFS client does not provide the required CIM module");
  return {
    module: "cim",
    cashAcceptance: new CashAcceptanceService({ ...context.cashAcceptance, client: context.client.cim }),
  };
}

export const cimDeviceModuleAdapter: XfsDeviceModuleAdapter = {
  module: "cim",
  requiredModule: "cim",
  create: async (context) => {
    const rpcClient = context.client.cim;
    if (!rpcClient) throw new Error("The XFS client does not provide the required CIM module");
    const port = createCimDepositDevicePort(
      rpcClient,
      context.session.id,
      context.timeoutMs,
    );
    const id = context.config.deviceId ?? context.config.logicalName;
    return {
      descriptor: { id, type: "cash.acceptance", capabilities: ["cash.acceptance", "cash.escrow"] },
      port,
      healthCheck: {
        id: `xfs.cim.${id}`,
        check: async () => {
          const status = await createCimCashInClient(rpcClient, context.session.id).getCashInStatus();
          return { id: `xfs.cim.${id}`, status: status.status === "unknown" ? "degraded" : "healthy" };
        },
      },
    };
  },
};

export function createCimDepositDevicePort(
  rpcClient: XfsCimRpcClient,
  sessionId: string,
  timeoutMs = 5_000,
  now: () => Date = () => new Date(),
): CimCashAcceptanceDevicePort {
  const client = createCimCashInClient(rpcClient, sessionId);
  return {
    createService: (dependencies) => new CashAcceptanceService({ ...dependencies, client }),
    captureInventory: async () => captureInventory(rpcClient, sessionId, timeoutMs, now),
    resolveRefusedMedia: async (request) => resolveRefusedMedia(client, request),
  };
}

export function createCimCashInClient(client: XfsCimRpcClient, sessionId: string): CimCashInClient {
  return {
    getCapabilities: async () => {
      const capabilities = await client.getCapabilities({ sessionId, timeoutMs: 5_000 });
      return {
        maxCashInItems: capabilities.maxCashInItems,
        positions: capabilities.positions,
        retractAreas: capabilities.retractAreas,
        shutterControl: capabilities.shutterControl ? "service-provider" : "application",
      };
    },
    captureCashUnits: async () => normalizeCimCashUnits(
      await client.getCashUnitInfo({ sessionId, timeoutMs: 5_000 }),
    ),
    cashInStart: async (request) => {
      await client.cashInStart({ sessionId, tellerId: 0, ...request });
    },
    openShutter: async (request) => {
      await client.openShutter({ sessionId, position: request.position, timeoutMs: request.timeoutMs });
    },
    closeShutter: async (request) => {
      await client.closeShutter({ sessionId, position: request.position, timeoutMs: request.timeoutMs });
    },
    cashIn: async (request) => normalizeStatus(await client.cashIn({ sessionId, ...request })),
    getCashInStatus: async () => normalizeStatus(await client.getCashInStatus({ sessionId, timeoutMs: 5_000 })),
    cashInEnd: async (request) => normalizeCimCashUnits(
      await client.cashInEnd({ sessionId, ...request }),
    ),
    cashInRollback: async (request) => { await client.cashInRollback({ sessionId, ...request }); },
    waitForCashTaken: async (request) => {
      const deadline = Date.now() + request.timeoutMs;
      while (Date.now() < deadline) {
        if (request.signal?.aborted) return false;
        const status = normalizeStatus(await client.getCashInStatus({ sessionId, timeoutMs: 2_000 }));
        if (["taken", "empty", "inactive"].includes(status.status.toLowerCase())) return true;
        await delay(Math.min(200, Math.max(1, deadline - Date.now())));
      }
      return false;
    },
    retract: async (request) => {
      await client.retract({
        sessionId,
        retract: {
          outputPosition: request.outputPosition,
          retractArea: request.retractArea ?? 1,
          index: request.index ?? 0,
        },
        timeoutMs: request.timeoutMs,
      });
    },
  };
}

function normalizeStatus(value: unknown): { status: string; refusedCount?: number; notes?: readonly CashNoteCount[] } {
  const source = object(value);
  const native = object(source.native);
  const noteList = object(source.noteNumberList ?? native.noteNumberList);
  const rawNotes = Array.isArray(noteList.notes) ? noteList.notes : [];
  const notes = rawNotes.map(object).map((note) => ({
    noteId: number(note.noteId),
    count: number(note.count),
  })).filter((note) => Number.isFinite(note.noteId) && note.count > 0);
  const refused = source.refusedCount ?? source.refused ?? native.refused;
  return {
    status: String(source.status ?? native.status ?? "unknown"),
    ...(Number.isFinite(Number(refused)) ? { refusedCount: Number(refused) } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function captureInventory(
  client: XfsCimRpcClient,
  sessionId: string,
  timeoutMs: number,
  now: () => Date,
): Promise<CimInventoryCapture> {
  const response = await client.getCashUnitInfo({ sessionId, timeoutMs });
  const units = normalizeCimCashUnits(response);
  const content = JSON.stringify(units);
  return {
    capturedAt: now().toISOString(),
    revision: `cim-${fnv1a(content)}`,
    safeSummary: {
      cashInCount: sum(units, "cashInCount"),
      cashUnitCount: units.length,
      noteCount: sum(units, "count"),
      rejectCount: sum(units, "rejectCount"),
      retractedCount: sum(units, "retractedCount"),
    },
  };
}

async function resolveRefusedMedia(
  client: CimCashInClient,
  request: CimRefusedMediaRequest,
): Promise<CimRefusedMediaResult> {
  const taken = await client.waitForCashTaken?.({
    signal: request.signal,
    timeoutMs: request.takeTimeoutMs,
  });
  if (taken) return refusedResult("taken");
  if (request.signal?.aborted) return refusedResult("cancelled");
  if (!client.retract) return refusedResult("unknown");
  await client.retract({
    index: request.retractIndex,
    outputPosition: request.outputPosition,
    retractArea: request.retractArea,
    timeoutMs: request.retractTimeoutMs,
  });
  return refusedResult("retracted");
}

const refusedResult = (status: CimRefusedMediaResult["status"]): CimRefusedMediaResult => ({
  safeSummary: { mediaKind: "refusedCash", status },
  status,
});

const finiteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sum = (
  units: readonly object[],
  key: string,
): number => units.reduce((total, unit) => total + finiteNumber((unit as Record<string, unknown>)[key]), 0);

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
