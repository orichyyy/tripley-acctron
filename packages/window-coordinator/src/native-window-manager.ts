import {
  KioskError,
  type OpenWindowOptions,
  type WindowManagerPort,
  type WindowRef,
} from "@tripley-acctron/contracts";

export class NativeWindowManagerSkeleton implements WindowManagerPort {
  public async openWindow(_options: OpenWindowOptions): Promise<WindowRef> {
    throw unsupported();
  }

  public async closeWindow(_windowId: string): Promise<void> {
    throw unsupported();
  }

  public async sendToWindow<T>(_windowId: string, _message: T): Promise<void> {
    throw unsupported();
  }

  public async broadcast<T>(_message: T): Promise<void> {
    throw unsupported();
  }
}

function unsupported(): KioskError {
  return new KioskError(
    "window.nativeUnsupported",
    "Native window coordination requires tripley-native IDL support.",
  );
}
