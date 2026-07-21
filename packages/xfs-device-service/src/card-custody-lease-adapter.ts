import type { TripleyXfsClient, XfsCommandLease } from "@tripley-kit/xfs-client";

import type {
  CardCustodyLeasePort,
  CardCustodyLeaseSession,
} from "./card-custody-contracts";

type CommandLeaseClient = Pick<
  NonNullable<TripleyXfsClient["commandLeases"]>,
  "acquire" | "getHostEpoch" | "release"
>;

export interface XfsCardCustodyLeaseAdapterOptions {
  readonly commandLeases: CommandLeaseClient;
  readonly ownerInstanceId: string;
  readonly ttlMs?: number | undefined;
  readonly protectionPolicyProfileId?: string | undefined;
  readonly nextFencingToken: (request: {
    readonly operationId: string;
    readonly logicalService: string;
    readonly resourceGroup: string;
  }) => Promise<number>;
}

export class XfsCardCustodyLeaseAdapter implements CardCustodyLeasePort {
  readonly #ttlMs: number;

  public constructor(private readonly options: XfsCardCustodyLeaseAdapterOptions) {
    if (!options.ownerInstanceId.trim()) throw new Error("ownerInstanceId is required");
    this.#ttlMs = options.ttlMs ?? 30_000;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs <= 0) {
      throw new Error("ttlMs must be positive");
    }
  }

  public async acquire(
    request: Parameters<CardCustodyLeasePort["acquire"]>[0],
  ): Promise<CardCustodyLeaseSession> {
    const hostEpoch = await this.options.commandLeases.getHostEpoch();
    const fencingToken = await this.options.nextFencingToken(request);
    if (!Number.isSafeInteger(fencingToken) || fencingToken <= 0) {
      throw new Error("nextFencingToken returned an invalid fencing token");
    }
    const lease = await this.options.commandLeases.acquire({
      authority: request.authority,
      fencingToken,
      hostEpoch,
      logicalService: request.logicalService,
      operationId: request.operationId,
      ownerInstanceId: this.options.ownerInstanceId,
      ...(this.options.protectionPolicyProfileId
        ? { protectionPolicyProfileId: this.options.protectionPolicyProfileId }
        : {}),
      resourceGroup: request.resourceGroup,
      ttlMs: this.#ttlMs,
    });
    assertBinding(lease, request, this.options.ownerInstanceId);
    return new ActiveCardCustodyLease(this.options.commandLeases, lease);
  }
}

class ActiveCardCustodyLease implements CardCustodyLeaseSession {
  private released = false;

  public constructor(
    private readonly commandLeases: CommandLeaseClient,
    private readonly lease: XfsCommandLease,
  ) {}

  public get hostEpoch(): string {
    return this.lease.hostEpoch;
  }

  public get fencingToken(): number {
    return this.lease.fencingToken;
  }

  public async release(): Promise<void> {
    if (this.released) return;
    await this.commandLeases.release({
      fencingToken: this.lease.fencingToken,
      hostEpoch: this.lease.hostEpoch,
      logicalService: this.lease.logicalService,
      operationId: this.lease.operationId,
    });
    this.released = true;
  }
}

const assertBinding = (
  lease: XfsCommandLease,
  request: Parameters<CardCustodyLeasePort["acquire"]>[0],
  ownerInstanceId: string,
): void => {
  if (
    lease.logicalService !== request.logicalService ||
    lease.operationId !== request.operationId ||
    lease.resourceGroup !== request.resourceGroup ||
    lease.ownerInstanceId !== ownerInstanceId
  ) {
    throw new Error("Host command lease binding does not match the requested card resource");
  }
};
