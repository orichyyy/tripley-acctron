import type { RuntimeRole } from "./plugin";

export interface WindowManagerPort {
  openWindow(options: OpenWindowOptions): Promise<WindowRef>;
  closeWindow(windowId: string): Promise<void>;
  sendToWindow<T>(windowId: string, message: T): Promise<void>;
  broadcast<T>(message: T): Promise<void>;
}

export interface OpenWindowOptions {
  role: RuntimeRole;
  url?: string;
  title?: string;
  width?: number;
  height?: number;
  fullscreen?: boolean;
  metadata?: Record<string, unknown>;
}

export interface WindowRef {
  id: string;
  role: RuntimeRole;
}
