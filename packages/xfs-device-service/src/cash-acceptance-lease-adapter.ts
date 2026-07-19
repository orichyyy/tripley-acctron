import type { TripleyXfsClient, XfsCommandLease } from "@tripley-kit/xfs-client";

import type {
  CashAcceptanceLeasePort,
  CashAcceptanceLeaseSession,
} from "./cash-acceptance-contracts";

declare module "@tripley-kit/xfs-client" {
  interface XfsCommandLeaseRequest {
    resourceGroup?: string | undefined;
    ownerInstanceId?: string | undefined;
  }

  interface XfsCommandLease {
    resourceGroup: string;
    ownerInstanceId: string;
    reconnectProof: string;
    state: "active" | "suspect" | "protection" | "intervention";
    configHash: string;
  }
}

type CommandLeaseClient = NonNullable<TripleyXfsClient["commandLeases"]>;

export interface XfsCashAcceptanceLeaseAdapterOptions {
  readonly commandLeases: CommandLeaseClient;
  readonly ownerInstanceId: string;
  readonly ttlMs?: number | undefined;
  readonly nextFencingToken: (request: {
    readonly operationId: string;
    readonly logicalService: string;
    readonly resourceGroup: string;
  }) => Promise<number>;
}

export class XfsCashAcceptanceLeaseAdapter implements CashAcceptanceLeasePort {
  readonly #commandLeases: CommandLeaseClient;
  readonly #ownerInstanceId: string;
  readonly #ttlMs: number;
  readonly #nextFencingToken: XfsCashAcceptanceLeaseAdapterOptions["nextFencingToken"];

  constructor(options: XfsCashAcceptanceLeaseAdapterOptions) {
    if (!options.ownerInstanceId.trim()) throw new Error("ownerInstanceId is required");
    const ttlMs = options.ttlMs ?? 30_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be positive");
    this.#commandLeases = options.commandLeases;
    this.#ownerInstanceId = options.ownerInstanceId;
    this.#ttlMs = ttlMs;
    this.#nextFencingToken = options.nextFencingToken;
  }

  async acquire(request: {
    readonly operationId: string;
    readonly logicalService: string;
    readonly resourceGroup: string;
    readonly authority: "transaction";
  }): Promise<CashAcceptanceLeaseSession> {
    const hostEpoch = await this.#commandLeases.getHostEpoch();
    const fencingToken = await this.#nextFencingToken(request);
    if (!Number.isSafeInteger(fencingToken) || fencingToken <= 0) {
      throw new Error("nextFencingToken returned an invalid fencing token");
    }
    const lease = await this.#commandLeases.acquire({
      hostEpoch,
      logicalService: request.logicalService,
      operationId: request.operationId,
      fencingToken,
      authority: request.authority,
      ttlMs: this.#ttlMs,
      resourceGroup: request.resourceGroup,
      ownerInstanceId: this.#ownerInstanceId,
    });
    assertLeaseBinding(lease, request.resourceGroup, this.#ownerInstanceId);
    return new ActiveLeaseSession(this.#commandLeases, lease);
  }
}

class ActiveLeaseSession implements CashAcceptanceLeaseSession {
  #released = false;

  constructor(
    private readonly commandLeases: CommandLeaseClient,
    private readonly lease: XfsCommandLease,
  ) {}

  get fencingToken(): number {
    return this.lease.fencingToken;
  }

  async release(): Promise<void> {
    if (this.#released) return;
    await this.commandLeases.release({
      hostEpoch: this.lease.hostEpoch,
      logicalService: this.lease.logicalService,
      operationId: this.lease.operationId,
      fencingToken: this.lease.fencingToken,
    });
    this.#released = true;
  }
}

function assertLeaseBinding(
  lease: XfsCommandLease,
  resourceGroup: string,
  ownerInstanceId: string,
): void {
  if (lease.resourceGroup !== resourceGroup || lease.ownerInstanceId !== ownerInstanceId) {
    throw new Error("Host command lease binding does not match the requested cash resource group");
  }
}
