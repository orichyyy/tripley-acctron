import {
  KioskError,
  type CommandDef,
  type Disposable,
  type HostCommand,
  type Logger,
  type QueryDef,
  type ServiceApplyHostCommandRequest,
  type ServiceEnterMaintenanceRequest,
  type ServiceExitMaintenanceRequest,
  type ServiceOperationalStatus,
  type ServiceOperationalState,
  type ServiceResumeRequest,
  type TransactionCancelRequest,
  type TransactionLifecycleStatus,
  type TransactionStartRequest,
  type TypedCommandBus,
  type TypedQueryBus,
} from "@tripley-acctron/contracts";

export interface OperationalControlCommands {
  "service.applyHostCommand": CommandDef<ServiceApplyHostCommandRequest, ServiceOperationalStatus>;
  "service.resume": CommandDef<ServiceResumeRequest, ServiceOperationalStatus>;
  "service.enterMaintenance": CommandDef<ServiceEnterMaintenanceRequest, ServiceOperationalStatus>;
  "service.exitMaintenance": CommandDef<ServiceExitMaintenanceRequest, ServiceOperationalStatus>;
  "transaction.cancel": CommandDef<TransactionCancelRequest, TransactionLifecycleStatus>;
}

export interface OperationalControlQueries {
  "service.status": QueryDef<Record<never, never>, ServiceOperationalStatus>;
  "transaction.status": QueryDef<Record<never, never>, TransactionLifecycleStatus>;
}

export interface OperationalControlControllerOptions {
  commands: TypedCommandBus<OperationalControlCommands>;
  queries: TypedQueryBus<OperationalControlQueries>;
  logger: Logger;
}

export class OperationalControlController implements Disposable {
  private readonly disposables: Disposable[];
  private status: ServiceOperationalStatus = { state: "online" };

  public constructor(private readonly options: OperationalControlControllerOptions) {
    this.disposables = [
      options.commands.handle("service.applyHostCommand", (request) =>
        this.applyHostCommand(request),
      ),
      options.commands.handle("service.resume", (request) => this.resume(request)),
      options.commands.handle("service.enterMaintenance", (request) =>
        this.enterMaintenance(request),
      ),
      options.commands.handle("service.exitMaintenance", (request) =>
        this.exitMaintenance(request),
      ),
      options.queries.handle("service.status", () => this.getStatus()),
    ];
  }

  public async dispose(): Promise<void> {
    for (const disposable of this.disposables.reverse()) {
      await disposable.dispose();
    }
  }

  public getStatus(): ServiceOperationalStatus {
    return { ...this.status };
  }

  public beforeTransactionStart(_request: TransactionStartRequest): void {
    if (this.status.state === "maintenance") {
      throw new KioskError("service.maintenance", "Service is in maintenance mode.");
    }
    if (this.status.state === "suspended" || this.status.state === "suspending") {
      throw new KioskError("service.suspended", "Service is suspended.");
    }
  }

  public afterTransactionSettled(_status: TransactionLifecycleStatus): void {
    if (this.status.state !== "suspending" || !this.status.pendingSuspend) {
      return;
    }
    this.status = {
      ...this.status,
      state: "suspended",
      pendingSuspend: false,
    };
    this.options.logger.info(
      "Service suspended after transaction settled.",
      statusAttributes(this.status),
    );
  }

  private async applyHostCommand(
    request: ServiceApplyHostCommandRequest,
  ): Promise<ServiceOperationalStatus> {
    const command = request.command;
    switch (command.type) {
      case "suspendService":
        return await this.suspend(command, request.traceId);
      case "resumeService":
        return await this.resume({ traceId: request.traceId });
      case "enterMaintenance":
        return await this.enterMaintenance({
          traceId: request.traceId,
          ...(command.reason ? { reason: command.reason } : {}),
        });
      case "exitMaintenance":
        return await this.exitMaintenance({ traceId: request.traceId });
    }
  }

  private async suspend(command: HostCommand, traceId: string): Promise<ServiceOperationalStatus> {
    if (command.type !== "suspendService") {
      throw new KioskError("host.commandUnsupported", `Unsupported host command ${command.type}.`);
    }
    if (command.mode === "immediate") {
      await this.options.commands.execute("transaction.cancel", {
        reason: command.reason ?? "host.suspend.immediate",
      });
      this.status = serviceStatus({
        state: "suspended",
        reason: command.reason,
        traceId,
        pendingSuspend: false,
        lastHostCommand: command,
      });
      this.options.logger.info("Service suspended immediately.", statusAttributes(this.status));
      return this.getStatus();
    }

    const transaction = await this.options.queries.query("transaction.status", {});
    this.status = serviceStatus({
      state: transaction.state === "running" ? "suspending" : "suspended",
      reason: command.reason,
      traceId,
      pendingSuspend: transaction.state === "running",
      lastHostCommand: command,
    });
    this.options.logger.info("Service suspend scheduled.", statusAttributes(this.status));
    return this.getStatus();
  }

  private async resume(request: ServiceResumeRequest): Promise<ServiceOperationalStatus> {
    this.status = serviceStatus({
      state: "online",
      reason: request.reason,
      traceId: request.traceId,
      pendingSuspend: false,
    });
    this.options.logger.info("Service resumed.", statusAttributes(this.status));
    return this.getStatus();
  }

  private async enterMaintenance(
    request: ServiceEnterMaintenanceRequest,
  ): Promise<ServiceOperationalStatus> {
    await this.options.commands.execute("transaction.cancel", {
      reason: request.reason ?? "host.maintenance",
    });
    this.status = serviceStatus({
      state: "maintenance",
      reason: request.reason,
      traceId: request.traceId,
      pendingSuspend: false,
    });
    this.options.logger.info("Service entered maintenance.", statusAttributes(this.status));
    return this.getStatus();
  }

  private async exitMaintenance(
    request: ServiceExitMaintenanceRequest,
  ): Promise<ServiceOperationalStatus> {
    this.status = serviceStatus({
      state: "online",
      traceId: request.traceId,
      pendingSuspend: false,
    });
    this.options.logger.info("Service exited maintenance.", statusAttributes(this.status));
    return this.getStatus();
  }
}

export function registerOperationalControl(
  options: OperationalControlControllerOptions,
): OperationalControlController {
  return new OperationalControlController(options);
}

interface ServiceStatusDraft {
  state: ServiceOperationalState;
  reason?: string | undefined;
  traceId?: string | undefined;
  pendingSuspend?: boolean | undefined;
  lastHostCommand?: HostCommand | undefined;
}

function serviceStatus(status: ServiceStatusDraft): ServiceOperationalStatus {
  return {
    state: status.state,
    ...(status.reason ? { reason: status.reason } : {}),
    ...(status.traceId ? { traceId: status.traceId } : {}),
    ...(status.pendingSuspend !== undefined ? { pendingSuspend: status.pendingSuspend } : {}),
    ...(status.lastHostCommand ? { lastHostCommand: status.lastHostCommand } : {}),
  };
}

function statusAttributes(status: ServiceOperationalStatus): Record<string, unknown> {
  return { ...status };
}
