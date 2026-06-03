import type {
  ClockTimer,
  MoreTimeScreens,
  TimeoutHandle,
  TimeoutOptions,
  TimeoutResult,
  TimeoutService,
  TimeoutServiceOptions,
} from "@tripley-acctron/contracts";

export class DefaultTimeoutService implements TimeoutService {
  public constructor(private readonly options: TimeoutServiceOptions) {}

  public start(options: TimeoutOptions): TimeoutHandle {
    return new DefaultTimeoutHandle(this.options, options);
  }
}

class DefaultTimeoutHandle implements TimeoutHandle {
  private timer?: ClockTimer;
  private active = true;
  private durationMs: number;
  private resolveResult!: (result: TimeoutResult) => void;
  private rejectResult!: (error: unknown) => void;

  public readonly result: Promise<TimeoutResult>;

  public constructor(
    private readonly serviceOptions: TimeoutServiceOptions,
    private readonly timeoutOptions: TimeoutOptions,
  ) {
    this.durationMs = timeoutOptions.durationMs;
    this.result = new Promise<TimeoutResult>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    this.timeoutOptions.signal?.addEventListener("abort", () => this.cancel(), { once: true });
    this.schedule();
  }

  public get key(): string {
    return this.timeoutOptions.key;
  }

  public reset(durationMs = this.durationMs): void {
    if (!this.active) {
      return;
    }
    this.durationMs = durationMs;
    this.timer?.cancel();
    this.schedule();
  }

  public cancel(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.timer?.cancel();
  }

  private schedule(): void {
    this.timer = this.serviceOptions.clock.setTimeout(() => {
      void this.onExpired().catch((error: unknown) => {
        this.active = false;
        this.rejectResult(error);
      });
    }, this.durationMs);
  }

  private async onExpired(): Promise<void> {
    if (!this.active) {
      return;
    }

    this.timer?.cancel();
    const moreTime = this.timeoutOptions.moreTime;
    if (this.timeoutOptions.policy === "askMoreTime" && moreTime && this.serviceOptions.ui) {
      await this.serviceOptions.ui.openDialog(
        moreTime.dialog,
        moreTime.state ?? defaultMoreTimeState(moreTime.extensionMs),
      );
      const action = await this.serviceOptions.ui.waitAction(
        moreTime.dialog,
        this.timeoutOptions.signal ? { signal: this.timeoutOptions.signal } : {},
      );
      await this.serviceOptions.ui.closeDialog(String(moreTime.dialog));
      if (isMoreTimeYesAction(action)) {
        this.active = false;
        this.resolveResult({
          type: "continue",
          key: this.key,
          extensionMs: moreTime.extensionMs,
        });
        return;
      }
    }

    this.active = false;
    this.resolveResult({
      type: "expired",
      key: this.key,
      expiredAt: this.serviceOptions.clock.now(),
    });
  }
}

function defaultMoreTimeState(extensionMs: number): MoreTimeScreens["dialog.moreTime"]["state"] {
  return {
    remainingSeconds: Math.ceil(extensionMs / 1000),
  };
}

function isMoreTimeYesAction(action: unknown): action is { type: "yes" } {
  return typeof action === "object" && action !== null && "type" in action && action.type === "yes";
}
