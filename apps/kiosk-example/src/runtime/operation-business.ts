import type {
  CredentialAssessment,
  CustomerOperationExitContext,
  CustomerOperationResult,
  OperationExecutionContext,
} from "@tripley-kit/web-container-kiosk-runtime";

import type { OperationMaterialCapturePort } from "./operation-material";
import type { WithdrawalDiagnosticsSource } from "./operator-diagnostics";

export interface ExampleWithdrawalBusinessInput {
  readonly amount: number;
  readonly assessment: CredentialAssessment;
  readonly context: OperationExecutionContext;
}

export interface ExampleWithdrawalBusiness {
  readonly diagnostics?: WithdrawalDiagnosticsSource | undefined;
  readonly operationMaterial?: OperationMaterialCapturePort | undefined;
  execute(
    input: ExampleWithdrawalBusinessInput,
  ): Promise<CustomerOperationResult["safeOutput"]>;
  onOperationExit?(context: CustomerOperationExitContext): void;
}
