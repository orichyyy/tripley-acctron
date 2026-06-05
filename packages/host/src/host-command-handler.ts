import type {
  CommandDef,
  HostCommandHandler,
  ServiceApplyHostCommandRequest,
  ServiceOperationalStatus,
  TypedCommandBus,
} from "@tripley-acctron/contracts";

export interface HostCommandDispatchCommands {
  "service.applyHostCommand": CommandDef<ServiceApplyHostCommandRequest, ServiceOperationalStatus>;
}

export function createHostCommandHandler(
  commands: Pick<TypedCommandBus<HostCommandDispatchCommands>, "execute">,
): HostCommandHandler {
  return async (command, traceId) => {
    await commands.execute("service.applyHostCommand", { command, traceId });
  };
}
