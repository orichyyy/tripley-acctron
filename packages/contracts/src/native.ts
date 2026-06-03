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

export type PinpadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "enter"
  | "cancel"
  | "clear"
  | "backspace"
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8";

export interface PinpadWaitKeyOptions {
  signal?: AbortSignal;
}

export interface PinpadDevice {
  waitKey(options?: PinpadWaitKeyOptions): Promise<PinpadKey>;
  cancel(): Promise<void>;
}

export interface BarcodeResult {
  text: string;
  format?: string;
}

export interface BarcodeReadOptions {
  signal?: AbortSignal;
}

export interface BarcodeReaderDevice {
  read(options?: BarcodeReadOptions): Promise<BarcodeResult>;
  cancel(): Promise<void>;
}

export interface DeviceManager {
  pinpad?: PinpadDevice;
  barcodeReader?: BarcodeReaderDevice;
}
