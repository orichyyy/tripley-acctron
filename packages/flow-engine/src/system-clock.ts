import type { Clock, ClockTimer } from "@tripley-acctron/contracts";

export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }

  public setTimeout(callback: () => void, delayMs: number): ClockTimer {
    const timer = globalThis.setTimeout(callback, delayMs);
    return {
      cancel: () => globalThis.clearTimeout(timer),
    };
  }
}
