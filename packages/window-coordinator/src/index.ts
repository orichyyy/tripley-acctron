import type { RuntimeSnapshot } from "@tripley-acctron/contracts";
import type { ServiceStateController } from "@tripley-acctron/runtime-core";

export type SupervisorCommand =
  | { kind: "pause-service" }
  | { kind: "resume-service" }
  | { kind: "enter-maintenance" }
  | { kind: "exit-maintenance" };

export interface CoordinatorChannel {
  publishSnapshot(snapshot: RuntimeSnapshot): Promise<void>;
  subscribeSnapshot(handler: (snapshot: RuntimeSnapshot) => void): () => void;
  publishCommand(command: SupervisorCommand): Promise<void>;
  subscribeCommand(handler: (command: SupervisorCommand) => void): () => void;
}

export class MemoryCoordinatorChannel implements CoordinatorChannel {
  private readonly snapshotHandlers = new Set<(snapshot: RuntimeSnapshot) => void>();
  private readonly commandHandlers = new Set<(command: SupervisorCommand) => void>();

  public async publishSnapshot(snapshot: RuntimeSnapshot): Promise<void> {
    for (const handler of this.snapshotHandlers) {
      handler(snapshot);
    }
  }

  public subscribeSnapshot(handler: (snapshot: RuntimeSnapshot) => void): () => void {
    this.snapshotHandlers.add(handler);
    return () => this.snapshotHandlers.delete(handler);
  }

  public async publishCommand(command: SupervisorCommand): Promise<void> {
    for (const handler of this.commandHandlers) {
      handler(command);
    }
  }

  public subscribeCommand(handler: (command: SupervisorCommand) => void): () => void {
    this.commandHandlers.add(handler);
    return () => this.commandHandlers.delete(handler);
  }
}

export class RuntimeCoordinator {
  private unsubscribe: (() => void) | undefined;

  public constructor(
    private readonly state: ServiceStateController,
    private readonly channel: CoordinatorChannel,
  ) {}

  public async start(): Promise<void> {
    if (this.unsubscribe !== undefined) return;
    this.unsubscribe = this.channel.subscribeCommand((command) => {
      void this.applyCommand(command);
    });
    await this.publishSnapshot();
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  public async applyCommand(command: SupervisorCommand): Promise<void> {
    switch (command.kind) {
      case "pause-service":
        this.state.requestAvailability("out-of-service");
        break;
      case "resume-service":
      case "exit-maintenance":
        this.state.requestAvailability("in-service");
        break;
      case "enter-maintenance":
        this.state.requestAvailability("maintenance");
        break;
    }
    await this.publishSnapshot();
  }

  public async publishSnapshot(): Promise<void> {
    await this.channel.publishSnapshot(this.state.getSnapshot());
  }
}
