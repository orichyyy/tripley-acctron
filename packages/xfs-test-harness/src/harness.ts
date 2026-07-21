import {
  IdcCardType,
  InfoControlScope,
  type TripleyXfsControlClient,
  createWebSocketXfsControlClient,
} from "@tripley-kit/xfs-control-client";

import type { XfsHostdTestConfig } from "./config";
import { classifyHostdConnectionError } from "./errors";

export interface XfsSimulatorLogicalServices {
  readonly bcr: string;
  readonly idc: string;
  readonly pin: string;
}

export class XfsHostdTestHarness {
  private readonly control: TripleyXfsControlClient;

  public constructor(private readonly config: XfsHostdTestConfig) {
    this.control = createWebSocketXfsControlClient({
      ...(config.authToken ? { authToken: config.authToken } : {}),
      url: config.url,
    });
  }

  public async connect(): Promise<void> {
    try {
      await this.control.connect();
    } catch (error) {
      throw classifyHostdConnectionError(this.config.url, error);
    }
  }

  public async discoverLogicalServices(): Promise<XfsSimulatorLogicalServices> {
    const { services } = await this.control.runtime.listLogicalServices({});
    return {
      bcr: resolveLogicalName(services, "BCR", this.config.bcrLogicalName),
      idc: resolveLogicalName(services, "IDC", this.config.idcLogicalName),
      pin: resolveLogicalName(services, "PIN", this.config.pinLogicalName),
    };
  }

  public async insertTestCard(logicalName: string): Promise<void> {
    const cardId = "tripley-acctron-contract-card";
    await this.control.idc.upsertCard({
      card: {
        cardType: IdcCardType.Magstripe,
        id: cardId,
        label: "Tripley Acctron Contract Card",
        track2: "4761739001010010=25122010000000000000",
      },
    });
    await delay(200);
    assertNativeOk(
      await this.control.idc.insertCardByLogicalService({ cardId, logicalName }),
      "insert IDC card",
    );
  }

  public async takeCard(logicalName: string): Promise<void> {
    await this.control.idc.takeCardByLogicalService({ logicalName });
  }

  public async cardMediaPosition(logicalName: string): Promise<number> {
    return (await this.control.idc.getMediaState({ logicalName })).position;
  }

  public async ensureNoCard(logicalName: string): Promise<void> {
    await this.control.idc.takeCardByLogicalService({ logicalName }).catch(() => undefined);
    const media = await this.control.idc.getMediaState({ logicalName });
    if (media.position !== 0) {
      throw new Error(
        `Failed to clear IDC simulator media for '${logicalName}': ${JSON.stringify(media)}.`,
      );
    }
  }

  public async setIdcAvailable(logicalName: string, available: boolean): Promise<void> {
    const status = await this.control.idc.getIdcStatus({ logicalName });
    await this.control.idc.setIdcStatus({
      logicalName,
      scope: InfoControlScope.Volatile,
      status: { ...status, fwDevice: available ? 0 : 1 },
    });
  }

  public async completeBarcode(logicalName: string, text: string): Promise<void> {
    await waitUntil(async () => {
      const state = await this.control.bcr.getReadState({ logicalName });
      return Boolean(state.activeCommandId);
    });
    assertNativeOk(
      await this.control.bcr.completeRead({ barcodeInvalid: false, logicalName, text }),
      "complete BCR read",
    );
  }

  public async pressPinDigits(
    logicalName: string,
    digits: string,
    options: { readonly terminate?: boolean } = {},
  ): Promise<void> {
    await delay(200);
    const keys = [...digits].map((digit) => ({
      completion: 6,
      digit: functionKeyForDigit(digit),
      isFdk: false,
    }));
    if (options.terminate) {
      keys.push({ completion: 1, digit: 0x0400, isFdk: false });
    }
    assertNativeOk(
      await this.control.runtime.pressPinKeys({
        keys,
        logicalName,
      }),
      "press PIN keys",
    );
  }

  public async waitForBarcodeIdle(logicalName: string): Promise<void> {
    await waitUntil(async () => {
      const state = await this.control.bcr.getReadState({ logicalName });
      return !state.activeCommandId;
    });
  }

  public async dispose(): Promise<void> {
    await this.control.dispose();
  }
}

interface LogicalServiceLike {
  readonly className: string;
  readonly enabled: boolean;
  readonly logicalName: string;
}

const resolveLogicalName = (
  services: readonly LogicalServiceLike[],
  className: string,
  override?: string,
): string => {
  if (override) {
    return override;
  }

  const service = services.find(
    (candidate) => candidate.enabled && candidate.className.toUpperCase() === className,
  );
  if (service) {
    return service.logicalName;
  }

  const available = services
    .map((candidate) => `${candidate.logicalName}:${candidate.className}`)
    .join(", ");
  throw new Error(`No enabled ${className} logical service found. Available: ${available}`);
};

const functionKeyForDigit = (digit: string): number => {
  const value = Number(digit);
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    throw new Error("PIN test input contains a non-digit character.");
  }
  return 1 << value;
};

const assertNativeOk = (result: { hresult?: number; hResult?: number }, action: string): void => {
  const hResult = result.hResult ?? result.hresult ?? 0;
  if (hResult !== 0) {
    throw new Error(`${action} failed with hResult 0x${(hResult >>> 0).toString(16)}`);
  }
};

const waitUntil = async (predicate: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for XFS simulator command state.");
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
