import { FrameworkError } from "@tripley/web-container-errors";

import type {
  CashInventorySnapshot,
  CashOperationEvidence,
} from "./cash-contracts";

export interface CashInvestigationFacts {
  readonly operationId: string;
  readonly evidence: readonly CashOperationEvidence[];
  readonly snapshots: readonly CashInventorySnapshot[];
  readonly reconciliationRequired: boolean;
}

export interface InvestigationArtifact {
  readonly id: string;
  readonly operationId: string;
  readonly kind: string;
  readonly projectorId: string;
  readonly projectorVersion: string;
  readonly schemaVersion: string;
  readonly contentType: string;
  readonly contentHash: string;
  readonly generatedAt: string;
  readonly safeContentReference: string;
  readonly deliveryOutcome: "pending" | "delivered" | "failed";
}

export interface CashInvestigationProjector {
  readonly id: string;
  readonly version: string;
  project(facts: CashInvestigationFacts): Promise<Omit<InvestigationArtifact,
    "id" | "operationId" | "projectorId" | "projectorVersion" | "generatedAt">>;
}

export class CashInvestigationProjectorRegistry {
  private readonly projectors = new Map<string, CashInvestigationProjector>();
  private frozen = false;

  public register(projector: CashInvestigationProjector): this {
    if (this.frozen || this.projectors.has(projector.id)) {
      throw new FrameworkError({
        category: "configuration",
        code: "cash.investigationProjector.registrationRejected",
        message: `Investigation projector registration rejected: ${projector.id}`,
      });
    }
    this.projectors.set(projector.id, projector);
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public async project(
    projectorId: string,
    facts: CashInvestigationFacts,
    id: string,
    now = new Date(),
  ): Promise<InvestigationArtifact> {
    const projector = this.projectors.get(projectorId);
    if (!projector) {
      throw new FrameworkError({
        category: "dependency",
        code: "cash.investigationProjector.missing",
        message: `Investigation projector is not registered: ${projectorId}`,
      });
    }
    const artifact = await projector.project(facts);
    return Object.freeze({
      ...artifact,
      generatedAt: now.toISOString(),
      id,
      operationId: facts.operationId,
      projectorId: projector.id,
      projectorVersion: projector.version,
    });
  }
}
