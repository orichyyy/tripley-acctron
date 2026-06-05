import type { CommandDef, QueryDef } from "./bus";
import type { HostCommand } from "./host";

export type ServiceOperationalState = "online" | "suspending" | "suspended" | "maintenance";

export interface ServiceOperationalStatus {
  state: ServiceOperationalState;
  reason?: string;
  traceId?: string;
  pendingSuspend?: boolean;
  lastHostCommand?: HostCommand;
}

export interface ServiceApplyHostCommandRequest {
  command: HostCommand;
  traceId: string;
}

export interface ServiceResumeRequest {
  reason?: string;
  traceId?: string;
}

export interface ServiceEnterMaintenanceRequest {
  reason?: string;
  traceId?: string;
}

export interface ServiceExitMaintenanceRequest {
  traceId?: string;
}

export type ServiceStatusRequest = Record<never, never>;

declare module "./bus" {
  interface KioskCommands {
    "service.applyHostCommand": CommandDef<
      ServiceApplyHostCommandRequest,
      ServiceOperationalStatus
    >;
    "service.resume": CommandDef<ServiceResumeRequest, ServiceOperationalStatus>;
    "service.enterMaintenance": CommandDef<
      ServiceEnterMaintenanceRequest,
      ServiceOperationalStatus
    >;
    "service.exitMaintenance": CommandDef<ServiceExitMaintenanceRequest, ServiceOperationalStatus>;
  }

  interface KioskQueries {
    "service.status": QueryDef<ServiceStatusRequest, ServiceOperationalStatus>;
  }
}
