import type { BarcodeReaderDevice, PinpadDevice } from "@tripley-acctron/contracts";

export class FakePinpad implements PinpadDevice {
  public readonly keys: string[] = [];
  public cancelled = false;

  public press(key: string): void {
    this.keys.push(key);
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
  }
}

export class FakeBarcodeReader implements BarcodeReaderDevice {
  public readonly scans: string[] = [];
  public cancelled = false;

  public scan(value: string): void {
    this.scans.push(value);
  }

  public async cancel(): Promise<void> {
    this.cancelled = true;
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
