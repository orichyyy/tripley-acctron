import {
  KioskError,
  type OpenWindowOptions,
  type WindowManagerPort,
  type WindowRef,
} from "@tripley-acctron/contracts";

export interface HeadlessWindowMessage<T = unknown> {
  windowId: string;
  message: T;
}

export class HeadlessWindowManager implements WindowManagerPort {
  public readonly messages: Array<HeadlessWindowMessage> = [];
  private readonly windows = new Map<string, WindowRef>();
  private nextId = 1;

  public async openWindow(options: OpenWindowOptions): Promise<WindowRef> {
    const ref = { id: `window-${this.nextId++}`, role: options.role };
    this.windows.set(ref.id, ref);
    return ref;
  }

  public async closeWindow(windowId: string): Promise<void> {
    if (!this.windows.delete(windowId)) {
      throw new KioskError("window.notFound", `Window ${windowId} was not found.`);
    }
  }

  public async sendToWindow<T>(windowId: string, message: T): Promise<void> {
    this.requireWindow(windowId);
    this.messages.push({ windowId, message });
  }

  public async broadcast<T>(message: T): Promise<void> {
    for (const window of this.windows.values()) {
      this.messages.push({ windowId: window.id, message });
    }
  }

  public listWindows(): WindowRef[] {
    return [...this.windows.values()];
  }

  private requireWindow(windowId: string): WindowRef {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new KioskError("window.notFound", `Window ${windowId} was not found.`);
    }
    return window;
  }
}
