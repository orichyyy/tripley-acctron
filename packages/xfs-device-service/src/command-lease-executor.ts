import type { XfsCommandLeaseRequest } from "@tripley-kit/xfs-client";

import type { XfsCommandLeaseClientLike } from "./types";

export interface XfsCommandLeaseExecution {
  readonly authority: XfsCommandLeaseRequest["authority"];
  readonly logicalService: string;
  readonly operationId: string;
  readonly protectionPolicyProfileId?: string | undefined;
  readonly resourceGroup?: string | undefined;
  readonly ttlMs: number;
}

export interface XfsCommandLeaseExecutor {
  run<T>(execution: XfsCommandLeaseExecution, command: () => Promise<T>): Promise<T>;
}

type XfsCommandLeaseClientSource =
  | XfsCommandLeaseClientLike
  | undefined
  | (() => XfsCommandLeaseClientLike | undefined);

export class HostCommandLeaseExecutor implements XfsCommandLeaseExecutor {
  private readonly queues = new Map<string, Promise<void>>();

  public constructor(
    private readonly clientSource: XfsCommandLeaseClientSource,
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
    if (!this.resolveClient()) {
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
    const client = this.resolveClient();
    if (!client) {
      return command();
    }
    const hostEpoch = await client.getHostEpoch();
    const lease = await client.acquireNext({
      authority: execution.authority,
      hostEpoch,
      logicalService: execution.logicalService,
      operationId: execution.operationId,
      ownerInstanceId: this.ownerInstanceId,
      ...(execution.protectionPolicyProfileId
        ? { protectionPolicyProfileId: execution.protectionPolicyProfileId }
        : {}),
      ...(execution.resourceGroup ? { resourceGroup: execution.resourceGroup } : {}),
      ttlMs: execution.ttlMs,
    });
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

  private resolveClient(): XfsCommandLeaseClientLike | undefined {
    return typeof this.clientSource === "function"
      ? this.clientSource()
      : this.clientSource;
  }
}
