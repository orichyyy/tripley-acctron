import type {
  InputSourceAdapter,
  InputSourceSession,
  UserInputSourceResult,
} from "./input-sources";

export interface CardReaderInputPort<TCardMaterial = unknown> {
  readCard(
    options?: unknown,
    context?: {
      readonly operationId: string;
      readonly signal?: AbortSignal | undefined;
    },
  ): Promise<TCardMaterial>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}

export const createCardReaderInputSourceAdapter = <TCardMaterial = unknown>(
  defaultDeviceId = "cardReader",
): InputSourceAdapter<unknown, UserInputSourceResult<TCardMaterial>> => ({
  canStart: (ctx, source) =>
    ctx.devices.has(source.deviceId ?? defaultDeviceId),
  dataClassification: "sensitive",
  kind: "cardReader.card",
  start: async (ctx, source) => {
    const deviceId = source.deviceId ?? defaultDeviceId;
    const port =
      ctx.devices.require<CardReaderInputPort<TCardMaterial>>(deviceId);
    const operationId = `${ctx.instanceId}.${ctx.nodeId}.${source.id}`;
    const result = port
      .readCard(source.options, {
        operationId,
        signal: ctx.signal,
      })
      .then((material) => ({
        kind: "card",
        safeSummary: safeCardSummary(material, source.kind),
        source: { deviceId, id: source.id, kind: source.kind },
        value: material,
      }));
    return {
      cancel: (reason) => port.cancel(operationId, reason),
      id: operationId,
      result,
      sourceId: source.id,
      sourceKind: source.kind,
    } satisfies InputSourceSession<UserInputSourceResult<TCardMaterial>>;
  },
});

const safeCardSummary = (
  material: unknown,
  sourceKind: string,
): Record<string, unknown> => {
  if (
    material &&
    typeof material === "object" &&
    "safeSummary" in material &&
    material.safeSummary &&
    typeof material.safeSummary === "object" &&
    !Array.isArray(material.safeSummary)
  ) {
    return {
      ...(material.safeSummary as Record<string, unknown>),
      sourceKind,
    };
  }
  return { captured: true, sourceKind };
};
