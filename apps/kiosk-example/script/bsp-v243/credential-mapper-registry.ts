import {
  BspOperationContextError,
  type BspCredentialMapper,
} from "./operation-context-contracts";

export class BspCredentialMapperRegistry {
  readonly #byEntryMethod = new Map<string, BspCredentialMapper>();
  readonly #byId = new Map<string, BspCredentialMapper>();

  register(mapper: BspCredentialMapper): void {
    if (this.#byId.has(mapper.id)) {
      throw new BspOperationContextError(
        "BSP_CREDENTIAL_MAPPER_DUPLICATE",
        `Credential mapper '${mapper.id}' is already registered`,
      );
    }

    for (const entryMethodId of mapper.entryMethodIds) {
      if (this.#byEntryMethod.has(entryMethodId)) {
        throw new BspOperationContextError(
          "BSP_CREDENTIAL_MAPPER_DUPLICATE",
          `Entry method '${entryMethodId}' already has a credential mapper`,
        );
      }
    }

    this.#byId.set(mapper.id, mapper);
    for (const entryMethodId of mapper.entryMethodIds) {
      this.#byEntryMethod.set(entryMethodId, mapper);
    }
  }

  require(entryMethodId: string): BspCredentialMapper {
    const mapper = this.#byEntryMethod.get(entryMethodId);
    if (mapper === undefined) {
      throw new BspOperationContextError(
        "BSP_CREDENTIAL_MAPPER_MISSING",
        `No BSP credential mapper is registered for '${entryMethodId}'`,
      );
    }
    return mapper;
  }
}
