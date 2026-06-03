import { describe, expect, test } from "vitest";
import type {
  Clock,
  ClockTimer,
  MoreTimeScreens,
  UiPort,
  WaitActionOptions,
} from "@tripley-acctron/contracts";
import { DefaultTimeoutService } from "./timeout-service";

describe("timeout service", () => {
  test("timeout expires", async () => {
    const clock = new TestClock();
    const service = new DefaultTimeoutService({ clock });

    const timeout = service.start({ key: "input", durationMs: 100 });
    clock.advanceBy(100);

    await expect(timeout.result).resolves.toEqual({
      type: "expired",
      key: "input",
      expiredAt: 100,
    });
  });

  test("reset restarts timer", async () => {
    const clock = new TestClock();
    const service = new DefaultTimeoutService({ clock });

    const timeout = service.start({ key: "input", durationMs: 100 });
    clock.advanceBy(90);
    timeout.reset(100);
    clock.advanceBy(90);

    const pending = timeout.result.then(() => "resolved");
    await Promise.resolve();
    await expect(Promise.race([pending, Promise.resolve("pending")])).resolves.toBe("pending");

    clock.advanceBy(10);
    await expect(timeout.result).resolves.toMatchObject({ type: "expired", expiredAt: 190 });
  });

  test("cancel prevents timeout", async () => {
    const clock = new TestClock();
    const service = new DefaultTimeoutService({ clock });

    const timeout = service.start({ key: "input", durationMs: 100 });
    timeout.cancel();
    clock.advanceBy(100);

    const pending = timeout.result.then(() => "resolved");
    await Promise.resolve();
    await expect(Promise.race([pending, Promise.resolve("pending")])).resolves.toBe("pending");
  });

  test("abort signal cancels timeout", async () => {
    const clock = new TestClock();
    const service = new DefaultTimeoutService({ clock });
    const abort = new AbortController();

    const timeout = service.start({ key: "input", durationMs: 100, signal: abort.signal });
    abort.abort();
    clock.advanceBy(100);

    const pending = timeout.result.then(() => "resolved");
    await Promise.resolve();
    await expect(Promise.race([pending, Promise.resolve("pending")])).resolves.toBe("pending");
  });

  test("more time yes continues", async () => {
    const clock = new TestClock();
    const ui = new TestUi();
    const service = new DefaultTimeoutService({ clock, ui });

    const timeout = service.start({
      key: "input",
      durationMs: 100,
      policy: "askMoreTime",
      moreTime: { dialog: "dialog.moreTime", extensionMs: 60_000 },
    });
    clock.advanceBy(100);
    await Promise.resolve();
    ui.emitAction({ type: "yes" });

    await expect(timeout.result).resolves.toEqual({
      type: "continue",
      key: "input",
      extensionMs: 60_000,
    });
    expect(ui.history).toContainEqual({
      type: "openDialog",
      screen: "dialog.moreTime",
      payload: { remainingSeconds: 60 },
    });
  });

  test("more time no expires", async () => {
    const clock = new TestClock();
    const ui = new TestUi();
    const service = new DefaultTimeoutService({ clock, ui });

    const timeout = service.start({
      key: "input",
      durationMs: 100,
      policy: "askMoreTime",
      moreTime: { dialog: "dialog.moreTime", extensionMs: 60_000 },
    });
    clock.advanceBy(100);
    await Promise.resolve();
    ui.emitAction({ type: "no" });

    await expect(timeout.result).resolves.toEqual({
      type: "expired",
      key: "input",
      expiredAt: 100,
    });
  });
});

interface ScheduledTask {
  id: number;
  dueAt: number;
  callback: () => void;
}

class TestClock implements Clock {
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

  public advanceBy(durationMs: number): void {
    this.nowMs += durationMs;
    const due = this.tasks.filter((task) => task.dueAt <= this.nowMs);
    for (const task of due) {
      this.clearTimeout(task.id);
      task.callback();
    }
  }

  private clearTimeout(id: number): void {
    const index = this.tasks.findIndex((task) => task.id === id);
    if (index >= 0) {
      this.tasks.splice(index, 1);
    }
  }
}

interface UiHistoryEntry {
  type: "openDialog" | "closeDialog";
  screen?: string;
  payload?: unknown;
}

class TestUi implements UiPort<MoreTimeScreens> {
  public readonly history: UiHistoryEntry[] = [];
  private waiters: Array<(action: MoreTimeScreens["dialog.moreTime"]["actions"]) => void> = [];

  public async show(): Promise<void> {}

  public async patch(): Promise<void> {}

  public async openDialog<K extends keyof MoreTimeScreens>(
    dialog: K,
    state: MoreTimeScreens[K]["state"],
  ): Promise<void> {
    this.history.push({ type: "openDialog", screen: String(dialog), payload: state });
  }

  public async closeDialog(dialogId?: string): Promise<void> {
    this.history.push(
      dialogId ? { type: "closeDialog", screen: dialogId } : { type: "closeDialog" },
    );
  }

  public waitAction<K extends keyof MoreTimeScreens>(
    _screen: K,
    options: WaitActionOptions = {},
  ): Promise<MoreTimeScreens[K]["actions"]> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve as (action: MoreTimeScreens["dialog.moreTime"]["actions"]) => void);
    });
  }

  public emitAction(action: MoreTimeScreens["dialog.moreTime"]["actions"]): void {
    this.waiters.shift()?.(action);
  }
}
