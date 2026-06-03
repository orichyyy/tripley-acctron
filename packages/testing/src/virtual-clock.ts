import type { Clock, ClockTimer } from "@tripley-acctron/contracts";

export interface ScheduledTask {
  id: number;
  dueAt: number;
  callback: () => void;
}

export class VirtualClock implements Clock {
  private nowMs = 0;
  private nextId = 1;
  private readonly tasks: ScheduledTask[] = [];

  public now(): number {
    return this.nowMs;
  }

  public setTimeout(callback: () => void, delayMs: number): ClockTimer {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.push({ id, dueAt: this.nowMs + delayMs, callback });
    return {
      cancel: () => this.clearTimeout(id),
    };
  }

  private clearTimeout(id: number): void {
    const index = this.tasks.findIndex((task) => task.id === id);
    if (index >= 0) {
      this.tasks.splice(index, 1);
    }
  }

  public advanceBy(durationMs: number): void {
    this.nowMs += durationMs;
    const due = this.tasks.filter((task) => task.dueAt <= this.nowMs);
    for (const task of due) {
      this.clearTimeout(task.id);
      task.callback();
    }
  }
}
