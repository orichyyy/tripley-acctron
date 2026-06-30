import { FrameworkError } from "@tripley/web-container-errors";

import type { ExtensionRegistration, OpenExtensionKind } from "./extension-registry";
import { GenericExtensionRegistry } from "./extension-registry";

export type DataClassification =
  | "public"
  | "internal"
  | "sensitive"
  | "restricted"
  | "secret"
  | (string & {});

export interface DeviceDescriptor {
  readonly id: string;
  readonly type: string;
  readonly vendor?: string | undefined;
  readonly model?: string | undefined;
  readonly capabilities: readonly string[];
  readonly ownerPluginId?: string | undefined;
  readonly dataClassification?: DataClassification | undefined;
}

export interface DeviceRegistrationOptions {
  readonly version?: string | undefined;
  readonly ownerPluginId?: string | undefined;
  readonly priority?: number | undefined;
  readonly duplicatePolicy?: "reject" | "replace" | "ignore" | "chain" | undefined;
  dispose?(): void | Promise<void>;
}

export interface DevicePort<TPort = unknown> {
  readonly descriptor: DeviceDescriptor;
  readonly port: TPort;
}

export interface DeviceFilter {
  readonly type?: string | undefined;
  readonly capability?: string | undefined;
  readonly ownerPluginId?: string | undefined;
}

export class DeviceRegistry {
  private readonly devices = new GenericExtensionRegistry<DevicePort>("devices");

  public register<TPort>(
    deviceId: string,
    device: DevicePort<TPort>,
    options: DeviceRegistrationOptions = {},
  ): void {
    if (device.descriptor.id !== deviceId) {
      throw new FrameworkError({
        category: "configuration",
        code: "device.descriptor.idMismatch",
        message: `Device descriptor id must match registration id: ${deviceId}`,
        metadata: { descriptorId: device.descriptor.id, deviceId },
      });
    }

    const registration = {
      id: deviceId,
      value: device as DevicePort,
      ...(options.version !== undefined ? { version: options.version } : {}),
      ...(options.ownerPluginId !== undefined ? { ownerPluginId: options.ownerPluginId } : {}),
      ...(options.priority !== undefined ? { priority: options.priority } : {}),
      ...(options.duplicatePolicy !== undefined
        ? { duplicatePolicy: options.duplicatePolicy }
        : {}),
      ...(options.dispose !== undefined ? { dispose: options.dispose } : {}),
    } satisfies ExtensionRegistration<DevicePort>;
    this.devices.register(registration);
  }

  public get<TPort = unknown>(deviceId: string): TPort | undefined {
    return this.devices.get(deviceId)?.port as TPort | undefined;
  }

  public require<TPort = unknown>(deviceId: string): TPort {
    const port = this.get<TPort>(deviceId);
    if (port === undefined) {
      throw new FrameworkError({
        category: "dependency",
        code: "device.missing",
        message: `Device is not registered: ${deviceId}`,
        metadata: { deviceId },
      });
    }

    return port;
  }

  public findByType<TPort = unknown>(type: string): TPort[] {
    return this.devices
      .list()
      .filter((registration) => registration.value.descriptor.type === type)
      .map((registration) => registration.value.port as TPort);
  }

  public has(deviceId: string): boolean {
    return this.devices.has(deviceId as OpenExtensionKind);
  }

  public list(filter: DeviceFilter = {}): DeviceDescriptor[] {
    return this.devices
      .list()
      .map((registration) => registration.value.descriptor)
      .filter((descriptor) => matchesDeviceFilter(descriptor, filter));
  }
}

const matchesDeviceFilter = (descriptor: DeviceDescriptor, filter: DeviceFilter): boolean => {
  if (filter.type && descriptor.type !== filter.type) {
    return false;
  }

  if (filter.capability && !descriptor.capabilities.includes(filter.capability)) {
    return false;
  }

  return !(filter.ownerPluginId && descriptor.ownerPluginId !== filter.ownerPluginId);
};
