import type { DurableHostDeliveryBridge, HostDeliveryRuntimeLike } from "./contracts";

export const createHostDeliveryBridge = (
  runtime: HostDeliveryRuntimeLike,
): DurableHostDeliveryBridge => ({
  dispatch: async (outboxId) => {
    await runtime.worker.runOnce(outboxId);
  },
  enqueue: (input) => runtime.queue.enqueue(input),
  get: (outboxId) => runtime.deliveries.get(outboxId),
  readResponse: (outboxId) => runtime.responses.read(outboxId),
});
