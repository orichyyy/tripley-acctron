import type { InputSourceAdapter, UserInputSourceResult } from "@tripley/web-container-device-core";

export const createDemoInputAdapter = (): InputSourceAdapter => ({
  canStart: () => true,
  kind: "demo.input",
  start: async (_ctx, source) => ({
    cancel: async () => {},
    id: `session.${source.id}`,
    result: Promise.resolve({
      kind: "plain",
      safeSummary: { sourceKind: source.kind },
      source: { id: source.id, kind: source.kind },
      value: (source.options as { demoValue?: string } | undefined)?.demoValue ?? "100",
    }),
    sourceId: source.id,
    sourceKind: source.kind,
  }),
});

export const createDemoQrAdapter = (): InputSourceAdapter => ({
  canStart: () => true,
  kind: "barcodeReader.qr",
  start: async (_ctx, source) => ({
    cancel: async () => {},
    id: `session.${source.id}`,
    result: new Promise<UserInputSourceResult>(() => {}),
    sourceId: source.id,
    sourceKind: source.kind,
  }),
});

export const createDemoSecurePinAdapter = (): InputSourceAdapter => ({
  canStart: () => true,
  kind: "pinpad.pin",
  start: async (_ctx, source) => ({
    cancel: async () => {},
    id: `session.${source.id}`,
    result: Promise.resolve({
      encryptedPinBlock: "not-logged-demo-pin-block",
      kind: "securePin",
      safeSummary: { hasEncryptedPinBlock: true, sourceKind: "pinpad.pin" },
      source: { id: source.id, kind: "pinpad.pin" },
    } as UserInputSourceResult),
    sourceId: source.id,
    sourceKind: source.kind,
  }),
});

export const createProjectSpecificInputExtension = (): InputSourceAdapter => ({
  canStart: () => true,
  kind: "bank.demoPalmScanner.identity",
  start: async (_ctx, source) => ({
    cancel: async () => {},
    id: `session.${source.id}`,
    result: Promise.resolve({
      kind: "identity",
      safeSummary: { sourceKind: source.kind },
      source: { id: source.id, kind: source.kind },
      value: "demo-customer",
    }),
    sourceId: source.id,
    sourceKind: source.kind,
  }),
});
