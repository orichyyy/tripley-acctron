import type {
  FlowExecutionContext,
  FlowHook,
  FlowHookEvent,
  FlowHookName,
} from "./types";

export async function runFlowHooks(
  hooks: readonly FlowHook[],
  name: FlowHookName,
  ctx: FlowExecutionContext,
  event: Omit<FlowHookEvent, "flowId" | "flowVersion" | "instanceId">,
): Promise<void> {
  const hookEvent: FlowHookEvent = {
    ...event,
    flowId: ctx.flowId,
    flowVersion: ctx.flowVersion,
    instanceId: ctx.instanceId,
  };
  for (const hook of hooks) {
    if (hook.name === name) {
      await hook.run(ctx, hookEvent);
    }
  }
}
