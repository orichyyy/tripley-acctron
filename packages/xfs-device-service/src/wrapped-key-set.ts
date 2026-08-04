import {
  XfsPinKeyUseFromRaw,
  type XfsPinImportKeyRequest,
} from "@tripley-kit/xfs-client";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import type { XfsNativeEnvelopeLike } from "./types";
import { assertXfsOk } from "./utils";

export interface XfsWrappedKeyMaterial {
  readonly encryptionKeyName: string;
  readonly keyName: string;
  readonly useFlags: number;
  readonly value: Uint8Array;
  readonly verificationData?: Uint8Array;
}

export interface XfsWrappedKeySetImportRequest {
  readonly keys: readonly XfsWrappedKeyMaterial[];
}

export interface XfsWrappedKeySetImportResult {
  readonly committed: true;
  readonly importedKeyCount: number;
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface XfsWrappedKeyImportClient {
  importKey(request: XfsPinImportKeyRequest): Promise<XfsNativeEnvelopeLike>;
}

export const importXfsWrappedKeySet = async (
  client: XfsWrappedKeyImportClient,
  sessionId: string,
  timeoutMs: number,
  request: XfsWrappedKeySetImportRequest,
): Promise<XfsWrappedKeySetImportResult> => {
  validateKeySet(request);
  let importedKeyCount = 0;
  try {
    for (const key of request.keys) {
      const result = await client.importKey({
        encKeyName: key.encryptionKeyName,
        ...(key.verificationData ? { ident: key.verificationData } : {}),
        keyName: key.keyName,
        sessionId,
        timeoutMs,
        useFlags: XfsPinKeyUseFromRaw(key.useFlags),
        value: key.value,
      });
      assertXfsOk(result, "pin.importKey", {
        importedKeyCount,
        keyCount: request.keys.length,
      });
      importedKeyCount += 1;
    }
  } catch {
    throw new FrameworkError({
      category: "native",
      code: "xfs.pin.keySetImport.failed",
      message: "The wrapped PIN key set was not fully imported.",
      metadata: { importedKeyCount, keyCount: request.keys.length },
    });
  }
  return {
    committed: true,
    importedKeyCount,
    safeSummary: { importedKeyCount, keySetCommitted: true },
  };
};

const validateKeySet = (request: XfsWrappedKeySetImportRequest): void => {
  if (request.keys.length === 0) {
    throw new Error("A wrapped key set must contain at least one key.");
  }
  const names = new Set<string>();
  for (const key of request.keys) {
    if (!key.keyName || !key.encryptionKeyName || key.value.length === 0) {
      throw new Error("Wrapped key material is incomplete.");
    }
    if (names.has(key.keyName)) {
      throw new Error("Wrapped key names must be unique within one set.");
    }
    names.add(key.keyName);
  }
};
