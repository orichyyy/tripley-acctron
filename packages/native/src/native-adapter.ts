import {
  createElectronTripleyNative,
  createTauriTripleyNative,
  createWebSocketTripleyNative,
  type CreateElectronTripleyNativeOptions,
  type NativePolicyConfig,
  type TripleyNative,
} from "@tripley-kit/native";
import {
  KioskError,
  type NativeClientFactory,
  type NativePlatform,
  type NativePorts,
} from "@tripley-acctron/contracts";

export interface TripleyNativeFactoryOptions {
  websocketUrl?: string;
  electron?: CreateElectronTripleyNativeOptions;
  policyConfig?: NativePolicyConfig;
}

export class TripleyNativeFactory implements NativeClientFactory {
  public constructor(private readonly options: TripleyNativeFactoryOptions = {}) {}

  public async create(platform: NativePlatform): Promise<TripleyNative> {
    if (platform === "tauri") {
      return createTauriTripleyNative();
    }
    if (platform === "electron") {
      if (!this.options.electron) {
        throw new KioskError("native.unavailable", "Electron native options were not provided.");
      }
      return createElectronTripleyNative(this.options.electron);
    }
    if (platform === "websocket") {
      if (!this.options.websocketUrl) {
        throw new KioskError("native.unavailable", "Native WebSocket URL was not provided.");
      }
      const native = createWebSocketTripleyNative({ url: this.options.websocketUrl });
      await native.connect();
      return native;
    }
    throw new KioskError(
      "native.unavailable",
      "Headless native platform has no real native client.",
    );
  }
}

export class TripleyNativePorts implements NativePorts {
  public readonly runtime;

  public constructor(private readonly native: TripleyNative) {
    this.runtime = {
      getInfo: () => this.native.runtime.getInfo(),
    };
  }
}
