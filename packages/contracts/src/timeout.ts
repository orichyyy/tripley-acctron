import type { ScreenMap, UiPort } from "./ui";

export interface ClockTimer {
  cancel(): void;
}

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ClockTimer;
}

export type TimeoutPolicy = "expire" | "askMoreTime";

export interface MoreTimeDialogState {
  remainingSeconds: number;
}

export interface MoreTimeScreens extends ScreenMap {
  "dialog.moreTime": {
    state: MoreTimeDialogState;
    actions: { type: "yes" } | { type: "no" };
  };
}

export interface MoreTimePolicy {
  dialog: keyof MoreTimeScreens;
  extensionMs: number;
  state?: MoreTimeDialogState;
}

export interface TimeoutOptions {
  key: string;
  durationMs: number;
  policy?: TimeoutPolicy;
  moreTime?: MoreTimePolicy;
  signal?: AbortSignal;
}

export type TimeoutResult =
  | { type: "expired"; key: string; expiredAt: number }
  | { type: "continue"; key: string; extensionMs: number };

export interface TimeoutHandle {
  readonly key: string;
  readonly result: Promise<TimeoutResult>;
  reset(durationMs?: number): void;
  cancel(): void;
}

export interface TimeoutService {
  start(options: TimeoutOptions): TimeoutHandle;
}

export interface TimeoutServiceOptions {
  clock: Clock;
  ui?: UiPort<MoreTimeScreens>;
}
