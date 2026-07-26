import type { XfsCommandLeaseRequest } from "@tripley-kit/xfs-client";

import type { XfsCommandLeaseClientLike } from "./types";

export interface XfsCommandLeaseExecution {
  readonly authority: XfsCommandLeaseRequest["authority"];
  readonly logicalService: string;
  readonly operationId: string;
  readonly resourceGroup?: string | undefined;
  readonly ttlMs: number;
}

export interface XfsCommandLeaseExecutor {
  run<T>(execution: XfsCommandLeaseExecution, command: () => Promise<T>): Promise<T>;
}

export class HostCommandLeaseExecutor implements XfsCommandLeaseExecutor {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly fencingTokens = new Map<string, number>();

  public constructor(
    private readonly client: XfsCommandLeaseClientLike | undefined,
    private readonly ownerInstanceId: string,
  ) {
    if (!ownerInstanceId.trim()) {
      throw new Error("ownerInstanceId is required");
    }
  }

  public async run<T>(
    execution: XfsCommandLeaseExecution,
    command: () => Promise<T>,
  ): Promise<T> {
    if (!this.client) {
      return command();
    }
    const previous = this.queues.get(execution.logicalService) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.executeWithLease(execution, command));
    const tail = current.then(() => undefined, () => undefined);
    this.queues.set(execution.logicalService, tail);
    try {
      return await current;
    } finally {
      if (this.queues.get(execution.logicalService) === tail) {
        this.queues.delete(execution.logicalService);
      }
    }
  }

  private async executeWithLease<T>(
    execution: XfsCommandLeaseExecution,
    command: () => Promise<T>,
  ): Promise<T> {
    const client = this.client;
    if (!client) {
      return command();
    }
    const hostEpoch = await client.getHostEpoch();
    const current = await client.status(execution.logicalService);
    const tokenKey = `${hostEpoch}:${execution.logicalService}`;
    const fencingToken = Math.max(
      Date.now(),
      (this.fencingTokens.get(tokenKey) ?? 0) + 1,
      (current?.fencingToken ?? 0) + 1,
    );
    const lease = await client.acquire({
      authority: execution.authority,
      fencingToken,
      hostEpoch,
      logicalService: execution.logicalService,
      operationId: execution.operationId,
      ownerInstanceId: this.ownerInstanceId,
      ...(execution.resourceGroup ? { resourceGroup: execution.resourceGroup } : {}),
      ttlMs: execution.ttlMs,
    });
    this.fencingTokens.set(tokenKey, lease.fencingToken);
    try {
      return await command();
    } finally {
      await client.release({
        fencingToken: lease.fencingToken,
        hostEpoch: lease.hostEpoch,
        logicalService: lease.logicalService,
        operationId: lease.operationId,
      });
    }
  }
}
