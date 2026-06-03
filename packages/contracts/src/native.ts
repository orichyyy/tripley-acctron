import type { TripleyNative } from "@tripley-kit/native";

export type NativePlatform = "tauri" | "electron" | "websocket" | "headless";

export interface NativeClientFactory {
  create(platform: NativePlatform): Promise<TripleyNative>;
}

export interface NativeRuntimePort {
  getInfo(): Promise<{
    platform: string;
    arch: string;
    family: string;
    capabilities: string[];
    policyMode: string;
  }>;
}

export interface NativePorts {
  runtime: NativeRuntimePort;
}

export interface PinpadDevice {
  cancel(): Promise<void>;
}

export interface BarcodeReaderDevice {
  cancel(): Promise<void>;
}

export interface DeviceManager {
  pinpad?: PinpadDevice;
  barcodeReader?: BarcodeReaderDevice;
}
