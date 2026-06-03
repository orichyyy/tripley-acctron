export interface ScreenMap {
  [screen: string]: {
    state: unknown;
    actions: unknown;
  };
}

export interface WaitActionOptions {
  signal?: AbortSignal;
}

export interface UiPort<Screens extends ScreenMap = ScreenMap> {
  show<K extends keyof Screens>(screen: K, state: Screens[K]["state"]): Promise<void>;
  patch<K extends keyof Screens>(screen: K, patch: Partial<Screens[K]["state"]>): Promise<void>;
  openDialog<K extends keyof Screens>(dialog: K, state: Screens[K]["state"]): Promise<void>;
  closeDialog(dialogId?: string): Promise<void>;
  waitAction<K extends keyof Screens>(
    screen: K,
    options?: WaitActionOptions,
  ): Promise<Screens[K]["actions"]>;
}
