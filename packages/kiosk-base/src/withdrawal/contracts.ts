import type { CommandRegistry } from "@tripley/web-container-command-system";
import type { ConditionRegistry } from "@tripley/web-container-condition-engine";
import type { InputSourceRegistry } from "@tripley/web-container-device-core";
import type { FlowDefinition, FlowInstanceSnapshot } from "@tripley/web-container-flow-engine";

import type { createKioskProjectBlueprint } from "../preset";
import type { TransactionRecord } from "../repositories";

export interface WithdrawalExampleProject {
  readonly blueprint: ReturnType<typeof createKioskProjectBlueprint>;
  readonly commandRegistry: CommandRegistry;
  readonly conditionRegistry: ConditionRegistry;
  readonly inputSources: InputSourceRegistry;
  readonly flow: FlowDefinition;
  readonly scenario: WithdrawalScenarioSummary;
  runCommand(): Promise<TransactionRecord>;
  runValidationFailure(): Promise<FlowInstanceSnapshot>;
  runSecurePin(): Promise<FlowInstanceSnapshot>;
}

export interface WithdrawalScenarioSummary {
  readonly commandId: string;
  readonly flowId: string;
  readonly dynamicUserInputNodeId: string;
  readonly optionalBarcodeQrInput: boolean;
  readonly validationFailureFeedbackKey: string;
  readonly securePinNodeId: string;
  readonly timeoutMs: number;
  readonly interruptId: string;
  readonly scopedStoreResetReason: string;
  readonly auditEventId: string;
  readonly loggingEventId: string;
  readonly extensionKind: string;
}
