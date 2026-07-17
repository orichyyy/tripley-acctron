import { CommandRegistry } from "@tripley/web-container-command-system";

import { LocalAuthenticationPlanPolicy } from "./authentication";
import { CustomerOperationCoordinator } from "./coordinator";
import { AuthenticationChallengeRegistry, EntryMethodRegistry } from "./registries";
import type {
  CapabilitySnapshot,
  CapabilityStatus,
  CustomerOperationResult,
  EntryMethodAvailabilitySnapshot,
  KioskRuntimeOptions,
  KioskRuntimeSnapshot,
  RuntimeReadiness,
  StartCustomerOperationInput,
} from "./types";

export class KioskRuntime {
  public readonly commands = new CommandRegistry();
  public readonly entryMethods = new EntryMethodRegistry();
  public readonly authenticationChallenges = new AuthenticationChallengeRegistry();
  private readonly capabilities: MutableCapabilitySnapshot;
  private readonly coordinator: CustomerOperationCoordinator;
  private readonly readinessListeners = new Set<(readiness: RuntimeReadiness) => void>();
  private readiness: RuntimeReadiness;
  private startupRecoveryStatus: "ready" | "recovering" | "intervention" = "ready";

  public constructor(private readonly options: KioskRuntimeOptions) {
    this.capabilities = createCapabilitySnapshot(options.capabilities ?? {});
    for (const entry of options.entryMethods ?? []) {
      this.entryMethods.register(entry);
    }
    for (const challenge of options.authenticationChallenges ?? []) {
      this.authenticationChallenges.register(challenge);
    }
    const policy = new LocalAuthenticationPlanPolicy(
      this.authenticationChallenges,
      options.mandatoryAuthentication,
    );
    this.coordinator = new CustomerOperationCoordinator(
      options,
      this.entryMethods,
      this.authenticationChallenges,
      policy,
      this.capabilities,
    );
    this.readiness = { entryMethods: [], mode: options.mode, status: "failed" };
    this.registerCommands();
  }

  public async initialize(): Promise<KioskRuntimeSnapshot> {
    await this.passRecoveryStartupBarrier();
    await this.coordinator.recover();
    this.setReadiness(await this.evaluateReadiness());
    return this.snapshot();
  }

  public snapshot(): KioskRuntimeSnapshot {
    return { operation: this.coordinator.snapshot(), readiness: this.readiness };
  }

  public subscribe(listener: Parameters<CustomerOperationCoordinator["subscribe"]>[0]): () => void {
    return this.coordinator.subscribe(listener);
  }

  public subscribeReadiness(listener: (readiness: RuntimeReadiness) => void): () => void {
    this.readinessListeners.add(listener);
    listener(this.readiness);
    return () => this.readinessListeners.delete(listener);
  }

  public async start(input: StartCustomerOperationInput): Promise<CustomerOperationResult> {
    return this.commands.execute("withdrawal.start", {}, input);
  }

  public async interrupt(reasonCode?: string): Promise<void> {
    await this.coordinator.interrupt(reasonCode);
  }

  public async refreshCapabilities(
    values: Readonly<Record<string, CapabilityStatus>>,
  ): Promise<RuntimeReadiness> {
    this.capabilities.replace(values);
    this.setReadiness(await this.evaluateReadiness());
    await this.coordinator.interruptUnavailableCapabilities();
    return this.readiness;
  }

  public async dispose(): Promise<void> {
    await this.coordinator.interrupt("runtime.dispose");
    await this.options.ports.prompt?.dispose();
    await this.options.ports.logger?.flush?.();
    await this.options.ports.logger?.close?.();
  }

  private registerCommands(): void {
    this.commands.register({
      canExecute: async (_ctx, input: StartCustomerOperationInput) => {
        if (this.readiness.status === "recovering" || this.readiness.status === "intervention") {
          return { allowed: false, reasonCode: `runtime.${this.readiness.status}` };
        }
        const missingRuntimeCapability = (this.options.requiredCapabilities ?? []).find(
          (capabilityId) => this.capabilities.status(capabilityId) !== "available",
        );
        if (missingRuntimeCapability) {
          return {
            allowed: false,
            reasonCode: `capability.${missingRuntimeCapability}.unavailable`,
          };
        }
        const entry = this.readiness.entryMethods.find((item) => item.id === input.entryMethodId);
        if (!entry?.available) {
          return {
            allowed: false,
            messageKey: entry?.messageKey,
            reasonCode: entry?.reasonCode ?? "entryMethod.unavailable",
          };
        }
        if (this.coordinator.isActive()) {
          return { allowed: false, reasonCode: "operation.alreadyActive" };
        }
        return { allowed: true };
      },
      execute: (_ctx, input: StartCustomerOperationInput) => this.coordinator.start(input),
      id: "withdrawal.start",
      options: {
        idempotencyKey: (input) => `withdrawal:${(input as StartCustomerOperationInput).intentId}`,
        showLoadingWhileRunning: true,
      },
    });
  }

  private setReadiness(readiness: RuntimeReadiness): void {
    this.readiness = readiness;
    for (const listener of this.readinessListeners) {
      listener(readiness);
    }
  }

  private async evaluateReadiness(): Promise<RuntimeReadiness> {
    const entries: EntryMethodAvailabilitySnapshot[] = [];
    for (const contribution of this.entryMethods.list()) {
      const missingCapability = (contribution.requiredCapabilities ?? []).find(
        (id) => this.capabilities.status(id) !== "available",
      );
      const availability = missingCapability
        ? { available: false, reasonCode: `capability.${missingCapability}.unavailable` }
        : await contribution.availability({
            capabilities: this.capabilities,
            mode: this.options.mode,
          });
      entries.push({
        ...availability,
        id: contribution.id,
        labelKey: contribution.labelKey,
        order: contribution.order ?? 0,
        version: contribution.version,
      });
    }
    const available = entries.filter((entry) => entry.available).length;
    const missingRuntimeCapability = (this.options.requiredCapabilities ?? []).some(
      (capabilityId) => this.capabilities.status(capabilityId) !== "available",
    );
    const status = this.coordinator.isIntervention()
      ? "intervention"
      : this.startupRecoveryStatus !== "ready"
        ? this.startupRecoveryStatus
      : missingRuntimeCapability
        ? "failed"
        : available === 0
          ? "failed"
          : available === entries.length
            ? "ready"
            : "degraded";
    return { entryMethods: entries, mode: this.options.mode, status };
  }

  private async passRecoveryStartupBarrier(): Promise<void> {
    const policy = this.options.cashSafety;
    if (!policy?.enabled) return;
    if (!Number.isSafeInteger(policy.restartWindowMs) || policy.restartWindowMs <= 0) {
      throw new Error("Cash runtime safety requires an explicit positive restartWindowMs.");
    }
    const launcher = this.options.ports.launcherSupervision;
    const recovery = this.options.ports.recoveryStartup;
    if (!launcher || !recovery) {
      throw new Error(
        "Cash runtime safety requires launcher supervision and recovery startup ports.",
      );
    }
    const startup = await launcher.observeStartup();
    if (!startup.runtimeInstanceId || !startup.watchdogHealthy) {
      throw new Error("Kiosk Launcher supervision is not healthy.");
    }
    const lostAt = startup.previousRuntime?.lostAt;
    if (lostAt) {
      const elapsedMs = Date.parse(startup.startedAt) - Date.parse(lostAt);
      if (Number.isFinite(elapsedMs) && elapsedMs > policy.restartWindowMs) {
        await this.options.ports.audit?.append({
          data: {
            elapsedMs,
            previousRuntimeInstanceId: startup.previousRuntime?.instanceId,
            restartWindowMs: policy.restartWindowMs,
            runtimeInstanceId: startup.runtimeInstanceId,
          },
          eventId: "runtime.supervision.restartWindowBreached",
          message: "Kiosk Runtime started after its configured restart window.",
        });
      }
    }
    const result = await recovery.recover();
    this.startupRecoveryStatus = result.status;
    await this.options.ports.audit?.append({
      data: { ...result.safeSummary, status: result.status },
      eventId: "runtime.recovery.startupBarrier",
      message: "Kiosk Runtime evaluated its recovery startup barrier.",
    });
  }
}

export const createKioskRuntime = (options: KioskRuntimeOptions): KioskRuntime =>
  new KioskRuntime(options);

interface MutableCapabilitySnapshot extends CapabilitySnapshot {
  replace(values: Readonly<Record<string, CapabilityStatus>>): void;
}

const createCapabilitySnapshot = (
  initialValues: Readonly<Record<string, CapabilityStatus>>,
): MutableCapabilitySnapshot => {
  let values = Object.freeze({ ...initialValues });
  return {
    get values() {
      return values;
    },
    replace: (nextValues) => {
      values = Object.freeze({ ...nextValues });
    },
    status: (capabilityId) => values[capabilityId] ?? "unavailable",
  };
};
