import { CashAcceptanceService, type CashAcceptanceServiceDependencies } from "./cash-acceptance";
import type { CashNoteCount, CimCashInClient } from "./cash-acceptance-contracts";
import type { XfsDeviceModuleAdapter } from "./module-adapters";
import type { TripleyXfsClient } from "@tripley-kit/xfs-client";

declare module "./types" {
  interface XfsRuntimeClientLike {
    readonly cim?: XfsCimRpcClient | undefined;
  }
}

export interface CimModuleClientFacade {
  readonly cim: CimCashInClient;
}

export type XfsCimRpcClient = Pick<TripleyXfsClient["cim"],
  "cashInStart" | "cashIn" | "getCashInStatus" | "cashInEnd" | "cashInRollback" | "retract">;

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
    const client = createCimCashInClient(rpcClient, context.session.id);
    const port: CimCashAcceptanceDevicePort = {
      createService: (dependencies) => new CashAcceptanceService({ ...dependencies, client }),
    };
    const id = context.config.deviceId ?? context.config.logicalName;
    return {
      descriptor: { id, type: "cash.acceptance", capabilities: ["cash.acceptance", "cash.escrow"] },
      port,
      healthCheck: {
        id: `xfs.cim.${id}`,
        check: async () => {
          const status = await client.getCashInStatus();
          return { id: `xfs.cim.${id}`, status: status.status === "unknown" ? "degraded" : "healthy" };
        },
      },
    };
  },
};

export function createCimCashInClient(client: XfsCimRpcClient, sessionId: string): CimCashInClient {
  return {
    cashInStart: async (request) => {
      await client.cashInStart({ sessionId, tellerId: 0, useRecycleUnits: true, ...request });
    },
    cashIn: async (request) => normalizeStatus(await client.cashIn({ sessionId, ...request })),
    getCashInStatus: async () => normalizeStatus(await client.getCashInStatus({ sessionId, timeoutMs: 5_000 })),
    cashInEnd: async (request) => { await client.cashInEnd({ sessionId, ...request }); },
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
