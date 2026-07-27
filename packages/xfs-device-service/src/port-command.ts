import type {
  XfsCommandLeaseExecution,
  XfsCommandLeaseExecutor,
} from "./command-lease-executor";
import type {
  XfsDeviceOperationContext,
  XfsManagerClientLike,
  XfsNativeEnvelopeLike,
  XfsSessionLike,
  XfsSessionRequestLike,
} from "./types";
import { assertXfsOk } from "./utils";

export interface XfsDevicePortOptions<TClient> {
  readonly client: TClient;
  readonly commandLeases: XfsCommandLeaseExecutor;
  readonly deviceId: string;
  readonly logicalName: string;
  readonly manager: XfsManagerClientLike;
  readonly protectionPolicyProfileId?: string | undefined;
  readonly resourceGroup?: string | undefined;
  readonly resetBeforeRead?: boolean | undefined;
  readonly session: XfsSessionLike;
  readonly timeoutMs: number;
}

export const cancelSession = async (
  manager: XfsManagerClientLike,
  sessionId: string,
): Promise<void> => {
  await manager.cancelAsyncRequest({ requestId: 0, sessionId });
};

export const runLeasedCommand = <T>(
  options: XfsDevicePortOptions<unknown>,
  context: XfsDeviceOperationContext | undefined,
  action: string,
  authority: XfsCommandLeaseExecution["authority"],
  command: () => Promise<T>,
): Promise<T> =>
  options.commandLeases.run({
    authority,
    logicalService: options.logicalName,
    operationId: context?.operationId ??
      `${options.deviceId}.${action}.${crypto.randomUUID()}`,
    protectionPolicyProfileId: options.protectionPolicyProfileId,
    resourceGroup: options.resourceGroup,
    ttlMs: options.timeoutMs + 5_000,
  }, command);

export const resetDevice = async (
  client: { reset?(request: XfsSessionRequestLike): Promise<XfsNativeEnvelopeLike> },
  session: XfsSessionLike,
  timeoutMs: number,
): Promise<void> => {
  if (!client.reset) {
    return;
  }

  const result = await client.reset({ sessionId: session.id, timeoutMs });
  assertXfsOk(result, "device.reset");
};
