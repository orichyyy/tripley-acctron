import type {
  BarcodeReaderDevice,
  BarcodeResult,
  CardEjectResult,
  CardInsertedResult,
  CardReaderDevice,
  CashDispenseRequest,
  CashDispenseResult,
  CashDispenserDevice,
  DeviceOperationOptions,
  DeviceStatus,
  PrintRequest,
  PrinterDevice,
  PinpadDevice,
  PinpadKey,
  PinpadWaitKeyOptions,
} from "@tripley-acctron/contracts";

class PendingQueue<T> {
  private readonly pending: T[] = [];
  private readonly waiters: Array<(value: T) => void> = [];

  public push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(value);
      return;
    }
    this.pending.push(value);
  }

  public wait(options: DeviceOperationOptions = {}): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }

    const pending = this.pending.shift();
    if (pending) {
      return Promise.resolve(pending);
    }

    return new Promise((resolve, reject) => {
      this.waiters.push(resolve);
      options.signal?.addEventListener(
        "abort",
        () => {
          this.removeWaiter(resolve);
          reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  private removeWaiter(waiter: (value: T) => void): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
  }
}

export class FakePinpad implements PinpadDevice {
  public readonly keys: PinpadKey[] = [];
  public cancelled = false;
  private status: DeviceStatus = { health: "online" };
  private readonly queue = new PendingQueue<PinpadKey>();

  public press(key: PinpadKey): void {
    this.keys.push(key);
    this.queue.push(key);
  }

  public waitKey(options: PinpadWaitKeyOptions = {}): Promise<PinpadKey> {
    return this.queue.wait(options);
  }

  public setStatus(status: DeviceStatus): void {
    this.status = status;
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
  }

  public async getStatus(): Promise<DeviceStatus> {
    return this.status;
  }
}

export class FakeBarcodeReader implements BarcodeReaderDevice {
  public readonly scans: BarcodeResult[] = [];
  public cancelled = false;
  private status: DeviceStatus = { health: "online" };
  private readonly queue = new PendingQueue<BarcodeResult>();

  public scan(value: string | BarcodeResult): void {
    const result = typeof value === "string" ? { text: value } : value;
    this.scans.push(result);
    this.queue.push(result);
  }

  public read(options: { signal?: AbortSignal } = {}): Promise<BarcodeResult> {
    return this.queue.wait(options);
  }

  public setStatus(status: DeviceStatus): void {
    this.status = status;
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
  }

  public async getStatus(): Promise<DeviceStatus> {
    return this.status;
  }
}

export class FakeCardReader implements CardReaderDevice {
  public readonly insertedCards: CardInsertedResult[] = [];
  public readonly retainedReasons: string[] = [];
  public cancelled = false;
  public ejectResult: CardEjectResult = { taken: true };
  private status: DeviceStatus = { health: "online" };
  private readonly queue = new PendingQueue<CardInsertedResult>();

  public insert(card: CardInsertedResult = {}): void {
    this.insertedCards.push(card);
    this.queue.push(card);
  }

  public waitForCard(options: DeviceOperationOptions = {}): Promise<CardInsertedResult> {
    return this.queue.wait(options);
  }

  public async eject(): Promise<CardEjectResult> {
    return this.ejectResult;
  }

  public async retain(reason: string): Promise<void> {
    this.retainedReasons.push(reason);
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
  }

  public setStatus(status: DeviceStatus): void {
    this.status = status;
  }

  public async getStatus(): Promise<DeviceStatus> {
    return this.status;
  }
}

export class FakeCashDispenser implements CashDispenserDevice {
  public readonly dispenseRequests: CashDispenseRequest[] = [];
  public rejected = false;
  public retracted = false;
  public cancelled = false;
  private status: DeviceStatus = { health: "online" };

  public async dispense(request: CashDispenseRequest): Promise<CashDispenseResult> {
    this.dispenseRequests.push(request);
    const result: CashDispenseResult = {
      dispensed: true,
      amount: request.amount,
    };
    if (request.currency) {
      result.currency = request.currency;
    }
    return result;
  }

  public async reject(): Promise<void> {
    this.rejected = true;
  }

  public async retract(): Promise<void> {
    this.retracted = true;
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
  }

  public setStatus(status: DeviceStatus): void {
    this.status = status;
  }

  public async getStatus(): Promise<DeviceStatus> {
    return this.status;
  }
}

export class FakePrinter implements PrinterDevice {
  public readonly prints: PrintRequest[] = [];
  public cuts = 0;
  public cancelled = false;
  private status: DeviceStatus = { health: "online" };

  public async print(request: PrintRequest): Promise<void> {
    this.prints.push(request);
    if (request.cut) {
      this.cuts += 1;
    }
  }

  public async cut(): Promise<void> {
    this.cuts += 1;
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
  }

  public setStatus(status: DeviceStatus): void {
    this.status = status;
  }

  public async getStatus(): Promise<DeviceStatus> {
    return this.status;
  }
}

export function createFakeDevices(): {
  pinpad: FakePinpad;
  barcodeReader: FakeBarcodeReader;
  cardReader: FakeCardReader;
  cashDispenser: FakeCashDispenser;
  printer: FakePrinter;
} {
  return {
    pinpad: new FakePinpad(),
    barcodeReader: new FakeBarcodeReader(),
    cardReader: new FakeCardReader(),
    cashDispenser: new FakeCashDispenser(),
    printer: new FakePrinter(),
  };
}
