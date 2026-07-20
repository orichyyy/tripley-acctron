import type {
  XfsCommandLeaseClient,
  XfsProtectionJournalRecord,
  XfsProtectionStatus,
} from "@tripley-kit/xfs-client";

import type {
  HostProtectionJournalRecord,
  HostProtectionStatus,
  ProtectionRecoveryHostPort,
} from "./protection-recovery-contracts";

type ProtectionClient = Pick<
  XfsCommandLeaseClient,
  "getHostEpoch" | "protectionStatus" | "protectionJournal" | "acknowledgeProtection"
>;

export class XfsProtectionRecoveryHostAdapter implements ProtectionRecoveryHostPort {
  public constructor(private readonly client: ProtectionClient) {}

  public getHostEpoch(): Promise<string> {
    return this.client.getHostEpoch();
  }

  public async protectionStatus(resourceGroup: string): Promise<HostProtectionStatus> {
    return copyStatus(await this.client.protectionStatus(resourceGroup));
  }

  public async protectionJournal(
    operationId: string,
  ): Promise<readonly HostProtectionJournalRecord[]> {
    return (await this.client.protectionJournal(operationId)).map(copyJournalRecord);
  }

  public acknowledgeProtection(input: {
    readonly hostEpoch: string;
    readonly resourceGroup: string;
    readonly operationId: string;
  }): Promise<void> {
    return this.client.acknowledgeProtection(input);
  }
}

const copyStatus = (status: XfsProtectionStatus): HostProtectionStatus => ({
  action: status.action,
  configHash: status.configHash,
  custodyOutcome: status.custodyOutcome,
  ...(status.deadlineEpochMs === undefined ? {} : { deadlineEpochMs: status.deadlineEpochMs }),
  fencingToken: status.fencingToken,
  operationId: status.operationId,
  phase: status.phase,
  protectionPolicyProfileHash: status.protectionPolicyProfileHash,
  protectionPolicyProfileId: status.protectionPolicyProfileId,
  protectionPolicyProfileVersion: status.protectionPolicyProfileVersion,
  reason: status.reason,
  resourceGroup: status.resourceGroup,
  state: status.state,
});

const copyJournalRecord = (record: XfsProtectionJournalRecord): HostProtectionJournalRecord => ({
  action: record.action,
  ...(record.deadlineEpochMs === undefined ? {} : { deadlineEpochMs: record.deadlineEpochMs }),
  executionCertainty: record.executionCertainty,
  fencingToken: record.fencingToken,
  id: record.id,
  logicalService: record.logicalService,
  module: record.module,
  operationId: record.operationId,
  outcome: record.outcome,
  phase: record.phase,
  protectionPolicyProfileHash: record.protectionPolicyProfileHash,
  protectionPolicyProfileId: record.protectionPolicyProfileId,
  protectionPolicyProfileVersion: record.protectionPolicyProfileVersion,
  resourceGroup: record.resourceGroup,
  safeDetail: record.safeDetail,
});
