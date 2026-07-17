import {
  type TripleyXfsClient,
  type XfsCommandAuthority,
  type XfsCommandLease,
} from "@tripley-kit/xfs-client";

let fencingSequence = 0;

export class XfsTestCommandLeaseSet {
  private constructor(
    private readonly client: TripleyXfsClient,
    private readonly leases: readonly XfsCommandLease[],
  ) {}

  public static async acquire(
    client: TripleyXfsClient,
    logicalServices: readonly string[],
    authority: XfsCommandAuthority = "transaction",
  ): Promise<XfsTestCommandLeaseSet> {
    const leaseClient = client.commandLeases;
    if (!leaseClient) {
      throw new Error("The hostd contract requires the XFS command-lease service.");
    }

    const hostEpoch = await leaseClient.getHostEpoch();
    const runId = `${process.pid}:${Date.now()}`;
    const leases: XfsCommandLease[] = [];
    try {
      for (const [index, logicalService] of logicalServices.entries()) {
        leases.push(await leaseClient.acquire({
          authority,
          fencingToken: nextFencingToken(index),
          hostEpoch,
          logicalService,
          operationId: `xfs-contract:${runId}:${logicalService}`,
          ttlMs: 60_000,
        }));
      }
      return new XfsTestCommandLeaseSet(client, leases);
    } catch (error) {
      await releaseLeases(client, leases);
      throw error;
    }
  }

  public async release(): Promise<void> {
    await releaseLeases(this.client, this.leases);
  }
}

const releaseLeases = async (
  client: TripleyXfsClient,
  leases: readonly XfsCommandLease[],
): Promise<void> => {
  const leaseClient = client.commandLeases;
  if (!leaseClient) return;

  for (const lease of [...leases].reverse()) {
    await leaseClient.release({
      fencingToken: lease.fencingToken,
      hostEpoch: lease.hostEpoch,
      logicalService: lease.logicalService,
      operationId: lease.operationId,
    }).catch(() => undefined);
  }
};

const nextFencingToken = (offset: number): number =>
  Date.now() * 1_000 + fencingSequence++ + offset;
