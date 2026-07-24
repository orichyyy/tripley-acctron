export interface OperationCredentialMaterial {
  readonly entryMethodId: string;
  readonly material: unknown;
  readonly operationId: string;
}

export interface OperationAuthenticationMaterial {
  readonly challengeId: string;
  readonly material: unknown;
  readonly operationId: string;
}

export interface OperationMaterialCapturePort {
  captureCredential(input: OperationCredentialMaterial): void | Promise<void>;
  captureAuthentication(input: OperationAuthenticationMaterial): void | Promise<void>;
}

export interface OperationMaterialSnapshot {
  readonly authentication: Readonly<Record<string, unknown>>;
  readonly credential: OperationCredentialMaterial;
}

interface MutableOperationMaterial {
  readonly authentication: Record<string, unknown>;
  credential?: OperationCredentialMaterial | undefined;
}

export class SensitiveOperationMaterialVault implements OperationMaterialCapturePort {
  readonly #operations = new Map<string, MutableOperationMaterial>();

  public captureCredential(input: OperationCredentialMaterial): void {
    this.record(input.operationId).credential = input;
  }

  public captureAuthentication(input: OperationAuthenticationMaterial): void {
    this.record(input.operationId).authentication[input.challengeId] = input.material;
  }

  public require(operationId: string): OperationMaterialSnapshot {
    const material = this.#operations.get(operationId);
    if (!material?.credential) {
      throw new Error("operation.material.credential-missing");
    }
    return {
      authentication: { ...material.authentication },
      credential: material.credential,
    };
  }

  public clear(operationId: string): void {
    this.#operations.delete(operationId);
  }

  public has(operationId: string): boolean {
    return this.#operations.has(operationId);
  }

  private record(operationId: string): MutableOperationMaterial {
    const existing = this.#operations.get(operationId);
    if (existing) {
      return existing;
    }
    const created: MutableOperationMaterial = { authentication: {} };
    this.#operations.set(operationId, created);
    return created;
  }
}
