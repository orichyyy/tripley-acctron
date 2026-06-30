export class IdCardReaderInputSourceAdapter
  implements InputSourceAdapter<IdCardReaderInputOptions, IdCardReaderInputResult>
{
  readonly kind = "bank.idCardReader.identity";
  readonly contractVersion = "1.0.0";
  readonly dataClassification = "sensitive";

  async canStart(ctx: UserInputExecutionContext) {
    return ctx.devices.has("idCardReader");
  }

  async start(
    ctx: UserInputExecutionContext,
    source: UserInputSourceDefinition<IdCardReaderInputOptions>,
  ) {
    const operationId = ctx.idGenerator.create("id_card_reader");
    const reader = ctx.devices.get<IdCardReaderPort>("idCardReader");

    const result = reader
      .readIdentity(source.options, {
        operationId,
        flowInstanceId: ctx.flowInstanceId,
        nodeId: ctx.nodeId,
        traceId: ctx.traceId,
        signal: ctx.signal,
      })
      .then((identity) => ({
        kind: "identityDocument",
        value: identity.tokenizedIdentity,
        source: { kind: "bank.idCardReader.identity", deviceId: identity.deviceId },
        safeSummary: {
          sourceKind: "bank.idCardReader.identity",
          documentType: identity.documentType,
          hasTokenizedIdentity: true,
        },
      }));

    return {
      id: operationId,
      sourceId: source.id,
      sourceKind: this.kind,
      result,
      cancel: async (reason?: string) => reader.cancel(operationId, reason),
    };
  }
}
