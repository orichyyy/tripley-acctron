import type { ScreenMap, UiPort, WaitActionOptions } from "@tripley-acctron/contracts";

export interface UiRuntimeSnapshot {
  currentScreen: string | null;
  screenState: unknown;
  dialogs: Array<{ id: string; state: unknown }>;
}

export type UiRuntimeListener = (snapshot: UiRuntimeSnapshot) => void;

export class UiRuntimeStore {
  private snapshot: UiRuntimeSnapshot = {
    currentScreen: null,
    screenState: null,
    dialogs: [],
  };
  private readonly listeners = new Set<UiRuntimeListener>();
  private readonly waiters = new Map<string, Array<(action: unknown) => void>>();

  public getSnapshot(): UiRuntimeSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: UiRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public show(screen: string, state: unknown): void {
    this.snapshot = { ...this.snapshot, currentScreen: screen, screenState: state };
    this.emit();
  }

  public patch(patch: Record<string, unknown>): void {
    const current = isRecord(this.snapshot.screenState) ? this.snapshot.screenState : {};
    this.snapshot = { ...this.snapshot, screenState: { ...current, ...patch } };
    this.emit();
  }

  public openDialog(id: string, state: unknown): void {
    this.snapshot = {
      ...this.snapshot,
      dialogs: [...this.snapshot.dialogs, { id, state }],
    };
    this.emit();
  }

  public closeDialog(id?: string): void {
    const dialogs = id ? this.snapshot.dialogs.filter((dialog) => dialog.id !== id) : [];
    this.snapshot = { ...this.snapshot, dialogs };
    this.emit();
  }

  public waitAction(screen: string, options: WaitActionOptions = {}): Promise<unknown> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }

    return new Promise((resolve, reject) => {
      const waiters = this.waiters.get(screen) ?? [];
      waiters.push(resolve);
      this.waiters.set(screen, waiters);

      options.signal?.addEventListener(
        "abort",
        () => {
          this.waiters.set(
            screen,
            (this.waiters.get(screen) ?? []).filter((waiter) => waiter !== resolve),
          );
          reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  public emitAction(screen: string, action: unknown): void {
    const waiter = this.waiters.get(screen)?.shift();
    waiter?.(action);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

export class ReactUiAdapter<Screens extends ScreenMap = ScreenMap> implements UiPort<Screens> {
  public constructor(private readonly store: UiRuntimeStore) {}

  public async show<K extends keyof Screens>(screen: K, state: Screens[K]["state"]): Promise<void> {
    this.store.show(String(screen), state);
  }

  public async patch<K extends keyof Screens>(
    _screen: K,
    patch: Partial<Screens[K]["state"]>,
  ): Promise<void> {
    this.store.patch(patch as Record<string, unknown>);
  }

  public async openDialog<K extends keyof Screens>(
    dialog: K,
    state: Screens[K]["state"],
  ): Promise<void> {
    this.store.openDialog(String(dialog), state);
  }

  public async closeDialog(dialogId?: string): Promise<void> {
    this.store.closeDialog(dialogId);
  }

  public waitAction<K extends keyof Screens>(
    screen: K,
    options?: WaitActionOptions,
  ): Promise<Screens[K]["actions"]> {
    return this.store.waitAction(String(screen), options) as Promise<Screens[K]["actions"]>;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
