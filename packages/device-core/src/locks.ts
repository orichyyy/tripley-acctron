import { FrameworkError } from "@tripley/web-container-errors";

export interface DeviceOwner {
  readonly id: string;
  readonly type?: string | undefined;
  readonly flowInstanceId?: string | undefined;
  readonly nodeId?: string | undefined;
}

export interface DeviceLockOptions {
  readonly owner: DeviceOwner;
  readonly reason?: string | undefined;
}

export interface DeviceLease {
  readonly id: string;
  readonly deviceIds: readonly string[];
  readonly owner: DeviceOwner;
  release(): Promise<void>;
}

export class DeviceLockManager {
  private readonly heldByDevice = new Map<string, DeviceLeaseRecord>();
  private nextLeaseId = 1;

  public async acquire(
    deviceIds: readonly string[],
    options: DeviceLockOptions,
  ): Promise<DeviceLease> {
    const lease = await this.tryAcquire(deviceIds, options);
    if (!lease) {
      const lockedDeviceId = normalizeDeviceIds(deviceIds).find((deviceId) =>
        this.heldByDevice.has(deviceId),
      );
      throw new FrameworkError({
        category: "dependency",
        code: "device.lock.unavailable",
        message: `Device lock is unavailable: ${lockedDeviceId ?? "unknown"}`,
        metadata: { deviceId: lockedDeviceId ?? "unknown", ownerId: options.owner.id },
      });
    }

    return lease;
  }

  public async tryAcquire(
    deviceIds: readonly string[],
    options: DeviceLockOptions,
  ): Promise<DeviceLease | null> {
    const normalizedDeviceIds = normalizeDeviceIds(deviceIds);
    if (normalizedDeviceIds.length === 0) {
      return new NoopDeviceLease(options.owner);
    }

    if (normalizedDeviceIds.some((deviceId) => this.heldByDevice.has(deviceId))) {
      return null;
    }

    const record: DeviceLeaseRecord = {
      deviceIds: normalizedDeviceIds,
      id: `device-lease-${this.nextLeaseId}`,
      owner: options.owner,
      release: async () => {
        for (const deviceId of normalizedDeviceIds) {
          const held = this.heldByDevice.get(deviceId);
          if (held?.id === record.id) {
            this.heldByDevice.delete(deviceId);
          }
        }
      },
    };
    this.nextLeaseId += 1;

    for (const deviceId of normalizedDeviceIds) {
      this.heldByDevice.set(deviceId, record);
    }

    return record;
  }

  public isLocked(deviceId: string): boolean {
    return this.heldByDevice.has(deviceId);
  }
}

interface DeviceLeaseRecord extends DeviceLease {
  readonly id: string;
}

class NoopDeviceLease implements DeviceLease {
  public readonly id = "device-lease-noop";
  public readonly deviceIds: readonly string[] = [];

  public constructor(public readonly owner: DeviceOwner) {}

  public async release(): Promise<void> {}
}

const normalizeDeviceIds = (deviceIds: readonly string[]): string[] =>
  [...new Set(deviceIds)].sort((left, right) => left.localeCompare(right));
