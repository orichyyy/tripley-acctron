# 22. Device Abstraction Layer

## Purpose

Unify kiosk devices and prevent Flow/Command/Condition code from depending on vendor/native APIs directly.

## DeviceRegistry

```ts
export interface DeviceRegistry {
  register<TPort>(deviceId: string, device: DevicePort<TPort>, options?: DeviceRegistrationOptions): void;
  get<TPort>(deviceId: string): TPort;
  findByType<TPort>(type: string): TPort[];
  has(deviceId: string): boolean;
  list(filter?: DeviceFilter): DeviceDescriptor[];
}
```

## Device descriptor

```ts
export interface DeviceDescriptor {
  id: string;
  type: string;
  vendor?: string;
  model?: string;
  capabilities: string[];
  ownerPluginId?: string;
  dataClassification?: DataClassification;
}
```

## Standard events

```text
device.status.changed
device.fatal
device.card.inserted
device.card.removed
device.siu.headphone.inserted
device.siu.headphone.removed
device.cashUnit.empty
device.printer.paperLow
```

Project devices can define namespaced events.

## Device locks

```ts
export interface DeviceLockManager {
  acquire(deviceIds: string[], options: DeviceLockOptions): Promise<DeviceLease>;
  tryAcquire(deviceIds: string[], options: DeviceLockOptions): Promise<DeviceLease | null>;
}

export interface DeviceLease {
  id: string;
  deviceIds: string[];
  owner: DeviceOwner;
  release(): Promise<void>;
}
```

UserInputNodeExecutor acquires and releases device locks automatically.

## DevicePort examples

```ts
export interface PinpadPort {
  getData(options: PinpadGetDataOptions, context?: DeviceOperationContext): Promise<PinpadDataResult>;
  getPin(options: PinpadGetPinOptions, context?: DeviceOperationContext): Promise<PinpadPinResult>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}

export interface BarcodeReaderPort {
  startScan(options: BarcodeScanOptions, context?: DeviceOperationContext): Promise<BarcodeScanHandle>;
  stopScan(operationId?: string, reason?: string): Promise<void>;
}
```

## Extension

New devices register through plugins. Core must not know every possible device.

```ts
ctx.devices.register('idCardReader', {
  descriptor: { id: 'idCardReader', type: 'idCardReader', capabilities: ['identity.read', 'cancel'], dataClassification: 'sensitive' },
  port: createIdCardReaderPort(ctx.native.extensions)
});
```

## Health

Every device plugin should register health checks for availability, status, firmware/config where possible.
