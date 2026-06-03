import type {
  BarcodeReaderDevice,
  BarcodeResult,
  PinpadDevice,
  PinpadKey,
  PinpadWaitKeyOptions,
} from "@tripley-acctron/contracts";

export class FakePinpad implements PinpadDevice {
  public readonly keys: PinpadKey[] = [];
  public cancelled = false;
  private readonly pendingKeys: PinpadKey[] = [];
  private readonly waiters: Array<(key: PinpadKey) => void> = [];

  public press(key: PinpadKey): void {
    this.keys.push(key);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(key);
      return;
    }
    this.pendingKeys.push(key);
  }

  public waitKey(options: PinpadWaitKeyOptions = {}): Promise<PinpadKey> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }

    const pending = this.pendingKeys.shift();
    if (pending) {
      return Promise.resolve(pending);
    }

    return new Promise((resolve, reject) => {
      this.waiters.push(resolve);
      options.signal?.addEventListener(
        "abort",
        () => {
          this.removeKeyWaiter(resolve);
          reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
  }

  private removeKeyWaiter(waiter: (key: PinpadKey) => void): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
  }
}

export class FakeBarcodeReader implements BarcodeReaderDevice {
  public readonly scans: BarcodeResult[] = [];
  public cancelled = false;
  private readonly pendingScans: BarcodeResult[] = [];
  private readonly waiters: Array<(result: BarcodeResult) => void> = [];

  public scan(value: string | BarcodeResult): void {
    const result = typeof value === "string" ? { text: value } : value;
    this.scans.push(result);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(result);
      return;
    }
    this.pendingScans.push(result);
  }

  public read(options: { signal?: AbortSignal } = {}): Promise<BarcodeResult> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }

    const pending = this.pendingScans.shift();
    if (pending) {
      return Promise.resolve(pending);
    }

    return new Promise((resolve, reject) => {
      this.waiters.push(resolve);
      options.signal?.addEventListener(
        "abort",
        () => {
          this.removeScanWaiter(resolve);
          reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
  }

  private removeScanWaiter(waiter: (result: BarcodeResult) => void): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
  }
}

export function createFakeDevices(): {
  pinpad: FakePinpad;
  barcodeReader: FakeBarcodeReader;
} {
  return {
    pinpad: new FakePinpad(),
    barcodeReader: new FakeBarcodeReader(),
  };
}
