import type { Clock, TimeoutDecisionPort } from "@tripley-acctron/contracts";

export type TimeoutAction = "end-flow" | "ask-more-time";

export interface StepTimeout {
  action: TimeoutAction;
  stepId: string;
  timeoutMs: number;
  traceId?: string;
}

export interface TimeoutManagerOptions {
  clock: Clock;
  decision: TimeoutDecisionPort;
  onError?: (error: unknown) => void;
  onTimeout: (timeout: StepTimeout) => Promise<void>;
}

export class TimeoutManager {
  private handle?: unknown;
  private active: StepTimeout | undefined;

  public constructor(private readonly options: TimeoutManagerOptions) {}

  public start(timeout: StepTimeout): void {
    this.stop();
    this.active = timeout;
    this.handle = this.options.clock.setTimeout(() => {
      void this.expire(timeout).catch((error: unknown) => {
        if (this.options.onError !== undefined) {
          this.options.onError(error);
          return;
        }
        queueMicrotask(() => {
          throw error;
        });
      });
    }, timeout.timeoutMs);
  }

  public stop(): void {
    if (this.handle !== undefined) {
      this.options.clock.clearTimeout(this.handle);
    }
    this.handle = undefined;
    this.active = undefined;
  }

  private async expire(timeout: StepTimeout): Promise<void> {
    if (this.active !== timeout) {
      return;
    }
    if (timeout.action === "ask-more-time") {
      const answer = await this.options.decision.requestMoreTime({
        stepId: timeout.stepId,
        timeoutMs: timeout.timeoutMs,
        ...(timeout.traceId === undefined ? {} : { traceId: timeout.traceId }),
      });
      if (answer === "yes") {
        this.start(timeout);
        return;
      }
    }
    this.stop();
    await this.options.onTimeout(timeout);
  }
}
