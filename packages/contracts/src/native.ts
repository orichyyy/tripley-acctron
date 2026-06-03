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

export type DeviceHealth = "online" | "offline" | "busy" | "error" | "unknown";

export interface DeviceStatus {
  health: DeviceHealth;
  detail?: string;
}

export interface DeviceOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DeviceLease<TDevice> {
  device: TDevice;
  release(): Promise<void>;
}

export interface ClaimableDevice<TDevice> {
  claim(options?: DeviceOperationOptions): Promise<DeviceLease<TDevice>>;
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
  getStatus?(): Promise<DeviceStatus>;
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
  getStatus?(): Promise<DeviceStatus>;
}

export interface CardInsertedResult {
  atr?: string;
  track2?: string;
  pan?: string;
}

export interface CardEjectResult {
  taken: boolean;
}

export interface CardReaderDevice {
  waitForCard(options?: DeviceOperationOptions): Promise<CardInsertedResult>;
  eject(options?: DeviceOperationOptions): Promise<CardEjectResult>;
  retain(reason: string): Promise<void>;
  cancel(): Promise<void>;
  getStatus?(): Promise<DeviceStatus>;
}

export interface CashDispenseRequest {
  amount: number;
  currency?: string;
  cassetteId?: string;
}

export interface CashDispenseResult {
  dispensed: boolean;
  amount: number;
  currency?: string;
}

export interface CashDispenserDevice {
  dispense(
    request: CashDispenseRequest,
    options?: DeviceOperationOptions,
  ): Promise<CashDispenseResult>;
  reject(options?: DeviceOperationOptions): Promise<void>;
  retract(options?: DeviceOperationOptions): Promise<void>;
  cancel(): Promise<void>;
  getStatus?(): Promise<DeviceStatus>;
}

export interface PrintRequest {
  text: string;
  cut?: boolean;
}

export interface PrinterDevice {
  print(request: PrintRequest, options?: DeviceOperationOptions): Promise<void>;
  cut(options?: DeviceOperationOptions): Promise<void>;
  cancel(): Promise<void>;
  getStatus?(): Promise<DeviceStatus>;
}

export interface DeviceManager {
  pinpad?: PinpadDevice;
  barcodeReader?: BarcodeReaderDevice;
  cardReader?: CardReaderDevice;
  cashDispenser?: CashDispenserDevice;
  printer?: PrinterDevice;
}
