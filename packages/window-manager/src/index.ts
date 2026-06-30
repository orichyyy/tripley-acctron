import { FrameworkError } from "@tripley/web-container-errors";
import type { NativePort } from "@tripley/web-container-native-adapter";

export const windowManagerPackageName = "@tripley/web-container-window-manager";

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ManagedWindowFeatures {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly fullscreen?: boolean | undefined;
  readonly alwaysOnTop?: boolean | undefined;
  readonly resizable?: boolean | undefined;
  readonly frame?: boolean | undefined;
  readonly visible?: boolean | undefined;
  readonly transparent?: boolean | undefined;
  readonly skipTaskbar?: boolean | undefined;
  readonly focusOnOpen?: boolean | undefined;
  readonly displayId?: string | undefined;
}

export interface OpenManagedWindowOptions {
  readonly windowKey: string;
  readonly path: string;
  readonly payload?: unknown;
  readonly features?: ManagedWindowFeatures | undefined;
  readonly requiredCapabilities?: readonly string[] | undefined;
}

export interface ManagedWindowRef {
  readonly windowId: string;
  readonly windowKey: string;
}

export interface WindowSelector {
  readonly windowId?: string | undefined;
  readonly windowKey?: string | undefined;
}

export interface ManagedWindowInfo extends ManagedWindowRef {
  readonly path: string;
  readonly focused?: boolean | undefined;
  readonly visible?: boolean | undefined;
  readonly bounds?: WindowBounds | undefined;
  readonly displayId?: string | undefined;
}

export interface MoveToDisplayOptions {
  readonly center?: boolean | undefined;
}

export interface WindowMessage<T = unknown> {
  readonly topic: string;
  readonly payload?: T;
  readonly traceId?: string | undefined;
}

export interface WindowRequestOptions {
  readonly timeoutMs?: number | undefined;
}

export type WindowLifecycleEventType =
  | "opened"
  | "ready"
  | "focused"
  | "blurred"
  | "hidden"
  | "shown"
  | "minimized"
  | "restored"
  | "closed"
  | "crashed"
  | "boundsChanged"
  | "displayChanged"
  | "alwaysOnTopChanged";

export interface WindowLifecycleEvent {
  readonly type: WindowLifecycleEventType;
  readonly windowId: string;
  readonly windowKey: string;
  readonly at: string;
  readonly data?: Record<string, unknown> | undefined;
}

export interface NativeDisplay {
  readonly id: string;
  readonly index: number;
  readonly name?: string | undefined;
  readonly isPrimary: boolean;
  readonly bounds: WindowBounds;
  readonly workArea?: WindowBounds | undefined;
  readonly scaleFactor?: number | undefined;
  readonly rotation?: 0 | 90 | 180 | 270 | undefined;
  readonly touchSupport?: "unknown" | "available" | "unavailable" | undefined;
}

export interface DisplayRoleMapping {
  readonly front?: string | undefined;
  readonly rear?: string | undefined;
  readonly top?: string | undefined;
}

export interface WindowPort {
  open(options: OpenManagedWindowOptions): Promise<ManagedWindowRef>;
  close(selector: WindowSelector, reason?: string): Promise<void>;
  focus(selector: WindowSelector): Promise<void>;
  show(selector: WindowSelector): Promise<void>;
  hide(selector: WindowSelector): Promise<void>;
  minimize(selector: WindowSelector): Promise<void>;
  restore(selector: WindowSelector): Promise<void>;
  setAlwaysOnTop(selector: WindowSelector, alwaysOnTop: boolean): Promise<void>;
  setBounds(selector: WindowSelector, bounds: WindowBounds): Promise<void>;
  moveToDisplay(
    selector: WindowSelector,
    displayId: string,
    options?: MoveToDisplayOptions,
  ): Promise<void>;
  get(selector: WindowSelector): Promise<ManagedWindowInfo | null>;
  list(): Promise<ManagedWindowInfo[]>;
  broadcast<T = unknown>(message: WindowMessage<T>): Promise<void>;
  request<TRequest = unknown, TResponse = unknown>(
    target: WindowSelector,
    message: WindowMessage<TRequest>,
    options?: WindowRequestOptions,
  ): Promise<TResponse>;
}

export interface DisplayPort {
  listDisplays(): Promise<NativeDisplay[]>;
  getPrimaryDisplay(): Promise<NativeDisplay>;
  getDisplay(id: string): Promise<NativeDisplay | null>;
}

export interface NativeWindowBridge extends WindowPort, DisplayPort {
  readonly requiredCapabilities?: readonly string[] | undefined;
}

export class NativeWindowManagerPort implements WindowPort, DisplayPort {
  public static readonly requiredCapabilities = ["window.open", "display.list"] as const;

  public constructor(
    private readonly native: NativePort,
    private readonly bridge: NativeWindowBridge,
  ) {}

  public async assertRequiredCapabilities(): Promise<void> {
    await this.native.requireCapabilities([
      ...NativeWindowManagerPort.requiredCapabilities,
      ...(this.bridge.requiredCapabilities ?? []),
    ]);
  }

  public async open(options: OpenManagedWindowOptions): Promise<ManagedWindowRef> {
    await this.assertRequiredCapabilities();
    await this.native.requireCapabilities(featureCapabilities(options.features));
    await this.native.requireCapabilities(options.requiredCapabilities ?? []);
    return this.bridge.open(options);
  }

  public async close(selector: WindowSelector, reason?: string): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.bridge.close(selector, reason);
  }

  public async focus(selector: WindowSelector): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.bridge.focus(selector);
  }

  public async show(selector: WindowSelector): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.bridge.show(selector);
  }

  public async hide(selector: WindowSelector): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.bridge.hide(selector);
  }

  public async minimize(selector: WindowSelector): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.bridge.minimize(selector);
  }

  public async restore(selector: WindowSelector): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.bridge.restore(selector);
  }

  public async setAlwaysOnTop(selector: WindowSelector, alwaysOnTop: boolean): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.native.requireCapabilities(["window.alwaysOnTop"]);
    await this.bridge.setAlwaysOnTop(selector, alwaysOnTop);
  }

  public async setBounds(selector: WindowSelector, bounds: WindowBounds): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.native.requireCapabilities(["window.bounds"]);
    await this.bridge.setBounds(selector, bounds);
  }

  public async moveToDisplay(
    selector: WindowSelector,
    displayId: string,
    options?: MoveToDisplayOptions,
  ): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.native.requireCapabilities(["window.moveToDisplay"]);
    await this.bridge.moveToDisplay(selector, displayId, options);
  }

  public async get(selector: WindowSelector): Promise<ManagedWindowInfo | null> {
    await this.assertRequiredCapabilities();
    return this.bridge.get(selector);
  }

  public async list(): Promise<ManagedWindowInfo[]> {
    await this.assertRequiredCapabilities();
    return this.bridge.list();
  }

  public async broadcast<T = unknown>(message: WindowMessage<T>): Promise<void> {
    await this.assertRequiredCapabilities();
    await this.bridge.broadcast(message);
  }

  public async request<TRequest = unknown, TResponse = unknown>(
    target: WindowSelector,
    message: WindowMessage<TRequest>,
    options?: WindowRequestOptions,
  ): Promise<TResponse> {
    await this.assertRequiredCapabilities();
    return this.bridge.request(target, message, options);
  }

  public async listDisplays(): Promise<NativeDisplay[]> {
    await this.assertRequiredCapabilities();
    return this.bridge.listDisplays();
  }

  public async getPrimaryDisplay(): Promise<NativeDisplay> {
    const primary = (await this.listDisplays()).find((display) => display.isPrimary);
    if (!primary) {
      throw new FrameworkError({
        category: "native",
        code: "display.primary.missing",
        message: "Native display API did not return a primary display.",
      });
    }

    return primary;
  }

  public async getDisplay(id: string): Promise<NativeDisplay | null> {
    return (await this.listDisplays()).find((display) => display.id === id) ?? null;
  }
}

export const featureCapabilities = (features: ManagedWindowFeatures = {}): string[] => {
  const capabilities: string[] = [];
  if (features.alwaysOnTop !== undefined) {
    capabilities.push("window.alwaysOnTop");
  }
  if (
    features.width !== undefined ||
    features.height !== undefined ||
    features.x !== undefined ||
    features.y !== undefined
  ) {
    capabilities.push("window.bounds");
  }
  if (features.displayId !== undefined) {
    capabilities.push("window.moveToDisplay");
  }
  if (features.fullscreen !== undefined) {
    capabilities.push("window.fullscreen");
  }

  return capabilities;
};
