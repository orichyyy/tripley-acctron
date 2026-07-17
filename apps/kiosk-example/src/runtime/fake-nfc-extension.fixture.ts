import { createDeviceOperationInputSourceAdapter } from "@tripley/web-container-device-core";

import type { ExampleRuntimeExtension } from "./create-runtime";
import { runUserInput } from "./input-runner";

interface FakeNfcPort {
  read(): Promise<string>;
}

export const createFakeNfcExtension = (): ExampleRuntimeExtension => ({
  capabilities: { "device.nfc": "available" },
  createEntryMethods: (dependencies) => [
    {
      acquisition: {
        acquire: async (ctx) => {
          await runUserInput(ctx, dependencies, {
            id: "acquireNfc",
            profile: { id: "nfc", promptKey: "entry.nfc.tap" },
            promptId: "entry.nfc.tap",
            sources: [
              {
                deviceId: "nfcReader",
                id: "nfc",
                kind: "bank.nfc.tap",
                required: true,
              },
            ],
          });
          return {
            credential: {
              entryMethodId: "bank.nfc",
              id: `credential-${ctx.operationId}`,
              safeSummary: { acquired: true, entryMethodId: "bank.nfc" },
            },
            requirements: [],
            riskBand: "standard",
          };
        },
        flow: { flowId: "bank.withdrawal.nfc.acquire", version: "1.0.0" },
      },
      availability: () => ({ available: true }),
      id: "bank.nfc",
      labelKey: "entry.nfc",
      mediaCustody: { kind: "none", resolve: async () => ({ status: "none" }) },
      order: 15,
      requiredCapabilities: ["device.nfc"],
      version: "1.0.0",
    },
  ],
  id: "bank.fake-nfc",
  register: ({ devices, inputSources }) => {
    devices.register("nfcReader", {
      descriptor: {
        capabilities: ["nfc.read"],
        dataClassification: "sensitive",
        id: "nfcReader",
        ownerPluginId: "bank.fake-nfc",
        type: "nfcReader",
      },
      port: { read: async () => "RAW-NFC-TOKEN" } satisfies FakeNfcPort,
    });
    inputSources.register(
      createDeviceOperationInputSourceAdapter<FakeNfcPort>({
        dataClassification: "sensitive",
        defaultDeviceId: "nfcReader",
        kind: "bank.nfc.tap",
        start: async (port, source) => {
          const rawToken = await port.read();
          return {
            cancel: async () => {},
            id: "fake-nfc-session",
            result: Promise.resolve({
              kind: "nfcCredential",
              safeSummary: { acquired: rawToken.length > 0, sourceKind: source.kind },
              source: { deviceId: source.deviceId, id: source.id, kind: source.kind },
              value: rawToken,
            }),
            sourceId: source.id,
            sourceKind: source.kind,
          };
        },
      }),
    );
  },
});
