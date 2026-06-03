import type { RuntimeSnapshot, ServiceAvailability } from "@tripley-acctron/contracts";

export class ServiceStateController {
  private snapshot: RuntimeSnapshot = {
    availability: "in-service",
    transactionPhase: "idle",
  };

  public getSnapshot(): RuntimeSnapshot {
    return { ...this.snapshot };
  }

  public beginTransaction(): void {
    if (this.snapshot.availability !== "in-service" || this.snapshot.transactionPhase !== "idle") {
      throw new Error("A transaction cannot begin unless the runtime is idle and in service.");
    }
    this.snapshot = { ...this.snapshot, transactionPhase: "active" };
  }

  public beginRecovery(): void {
    this.snapshot = { ...this.snapshot, transactionPhase: "recovering" };
  }

  public finishTransaction(): void {
    const availability = this.snapshot.pendingAvailability ?? this.snapshot.availability;
    this.snapshot = { availability, transactionPhase: "idle" };
  }

  public requestAvailability(availability: ServiceAvailability): void {
    if (this.snapshot.transactionPhase === "idle") {
      this.snapshot = { availability, transactionPhase: "idle" };
      return;
    }
    this.snapshot = { ...this.snapshot, pendingAvailability: availability };
  }
}
