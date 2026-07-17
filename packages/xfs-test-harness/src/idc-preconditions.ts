import type { TripleyXfsClient } from "@tripley-kit/xfs-client";

import type { XfsHostdTestHarness } from "./harness";

export async function prepareIdcNoMedia(
  client: TripleyXfsClient,
  harness: XfsHostdTestHarness,
  logicalName: string,
  timeoutMs: number,
): Promise<void> {
  await resetIdc(client, logicalName, timeoutMs, "initial cleanup");
  await harness.ensureNoCard(logicalName);
  await resetIdc(client, logicalName, timeoutMs, "no-media confirmation");
}

async function resetIdc(
  client: TripleyXfsClient,
  logicalName: string,
  timeoutMs: number,
  phase: string,
): Promise<void> {
  const session = await client.manager.open({
    appId: "tripley.xfs-test-harness.idc-precondition",
    logicalName,
    serviceVersionsRequired: { high: 0x2803, low: 0x0203 },
    timeoutMs,
    traceLevel: 0,
  });
  try {
    const result = await client.idc.reset({ sessionId: session.session.id, timeoutMs });
    if (result.hResult !== 0) {
      throw new Error(`IDC ${phase} reset failed with HRESULT ${result.hResult}.`);
    }
  } finally {
    await client.manager.close({ sessionId: session.session.id });
  }
}
