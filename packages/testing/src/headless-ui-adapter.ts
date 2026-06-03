import type { ScreenMap, UiPort, WaitActionOptions } from "@tripley-acctron/contracts";

export interface UiHistoryEntry {
  type: "show" | "patch" | "openDialog" | "closeDialog";
  screen?: string;
  payload?: unknown;
}

export class HeadlessUiAdapter<Screens extends ScreenMap = ScreenMap> implements UiPort<Screens> {
  public readonly history: UiHistoryEntry[] = [];
  private waiters = new Map<string, Array<(action: unknown) => void>>();

  public async show<K extends keyof Screens>(screen: K, state: Screens[K]["state"]): Promise<void> {
    this.history.push({ type: "show", screen: String(screen), payload: state });
  }

  public async patch<K extends keyof Screens>(
    screen: K,
    patch: Partial<Screens[K]["state"]>,
  ): Promise<void> {
    this.history.push({ type: "patch", screen: String(screen), payload: patch });
  }

  public async openDialog<K extends keyof Screens>(
    dialog: K,
    state: Screens[K]["state"],
  ): Promise<void> {
    this.history.push({ type: "openDialog", screen: String(dialog), payload: state });
  }

  public async closeDialog(dialogId?: string): Promise<void> {
    this.history.push(
      dialogId ? { type: "closeDialog", screen: dialogId } : { type: "closeDialog" },
    );
  }

  public waitAction<K extends keyof Screens>(
    screen: K,
    options: WaitActionOptions = {},
  ): Promise<Screens[K]["actions"]> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }

    return new Promise((resolve, reject) => {
      const key = String(screen);
      const waiters = this.waiters.get(key) ?? [];
      const complete = (action: unknown) => resolve(action as Screens[K]["actions"]);
      waiters.push(complete);
      this.waiters.set(key, waiters);

      options.signal?.addEventListener(
        "abort",
        () => {
          this.removeWaiter(key, complete);
          reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  public emitAction<K extends keyof Screens>(screen: K, action: Screens[K]["actions"]): void {
    const key = String(screen);
    const waiter = this.waiters.get(key)?.shift();
    waiter?.(action);
  }

  private removeWaiter(key: string, waiter: (action: unknown) => void): void {
    const waiters = this.waiters.get(key) ?? [];
    this.waiters.set(
      key,
      waiters.filter((candidate) => candidate !== waiter),
    );
  }
}
