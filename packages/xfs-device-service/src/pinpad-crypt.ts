import {
  XfsPinAlgorithm,
  XfsPinCryptMode,
  type XfsPinCryptRequest,
} from "@tripley-kit/xfs-client";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import type { XfsNativeEnvelopeLike } from "./types";
import { assertXfsOk } from "./utils";

export type XfsPinDataCryptMode = "encrypt" | "decrypt";
export type XfsPinDataCryptAlgorithm =
  | "desEcb"
  | "desCbc"
  | "tripleDesEcb"
  | "tripleDesCbc";

export interface XfsPinDataCryptRequest {
  readonly algorithm: XfsPinDataCryptAlgorithm;
  readonly data: Uint8Array;
  readonly keyName: string;
  readonly mode: XfsPinDataCryptMode;
  readonly padding?: number;
  readonly startValue?: Uint8Array;
}

export interface XfsPinDataCryptResult {
  readonly data: Uint8Array;
  readonly safeSummary: Readonly<{
    algorithm: XfsPinDataCryptAlgorithm;
    dataLength: number;
    mode: XfsPinDataCryptMode;
  }>;
}

export interface XfsPinCryptClient {
  crypt(request: XfsPinCryptRequest): Promise<XfsNativeEnvelopeLike>;
}

export const runXfsPinDataCrypt = async (
  client: XfsPinCryptClient,
  sessionId: string,
  timeoutMs: number,
  request: XfsPinDataCryptRequest,
): Promise<XfsPinDataCryptResult> => {
  validateRequest(request);
  const result = await client.crypt({
    algorithm: algorithms[request.algorithm],
    compression: 0,
    cryptData: request.data,
    keyName: request.keyName,
    mode: request.mode === "encrypt" ? XfsPinCryptMode.Encrypt : XfsPinCryptMode.Decrypt,
    padding: request.padding ?? 0,
    sessionId,
    ...(request.startValue ? { startValue: request.startValue } : {}),
    timeoutMs,
  });
  assertXfsOk(result, "pin.crypt", {
    algorithm: request.algorithm,
    dataLength: request.data.length,
    mode: request.mode,
  });
  if (!(result.data instanceof Uint8Array)) {
    throw new FrameworkError({
      category: "native",
      code: "xfs.pin.crypt.missingData",
      message: "The XFS PIN crypt command returned no data.",
      metadata: {
        algorithm: request.algorithm,
        dataLength: request.data.length,
        mode: request.mode,
      },
    });
  }
  return {
    data: result.data.slice(),
    safeSummary: {
      algorithm: request.algorithm,
      dataLength: result.data.length,
      mode: request.mode,
    },
  };
};

const algorithms: Readonly<Record<XfsPinDataCryptAlgorithm, XfsPinAlgorithm>> = {
  desCbc: XfsPinAlgorithm.DesCbc,
  desEcb: XfsPinAlgorithm.DesEcb,
  tripleDesCbc: XfsPinAlgorithm.TridesCbc,
  tripleDesEcb: XfsPinAlgorithm.TridesEcb,
};

const validateRequest = (request: XfsPinDataCryptRequest): void => {
  if (!request.keyName || request.data.length === 0) {
    throw new Error("PIN crypt requires a key name and non-empty data.");
  }
  if (request.padding !== undefined && (!Number.isInteger(request.padding) || request.padding < 0 || request.padding > 255)) {
    throw new Error("PIN crypt padding must be one byte.");
  }
};
