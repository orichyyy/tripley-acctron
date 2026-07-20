import type { JsonValue } from "@tripley-kit/web-container-types";

import type { AuditJournalRecord, AuditJournalRepository } from "../repositories";
import type { Clock } from "./calendar";
import { systemClock } from "./calendar";

export interface AuditJournalAppendInput {
  readonly eventId: string;
  readonly eventName?: string | undefined;
  readonly businessType?: string | undefined;
  readonly transactionId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly flowInstanceId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly message: string;
  readonly data?: JsonValue | undefined;
}

export class AuditJournalService {
  public constructor(
    private readonly repository: AuditJournalRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  public async append(input: AuditJournalAppendInput): Promise<AuditJournalRecord> {
    const record = {
      id: `audit-${this.clock.now().getTime()}-${Math.random().toString(16).slice(2)}`,
      createdAt: this.clock.now().toISOString(),
      eventId: input.eventId,
      message: input.message,
      ...(input.eventName !== undefined ? { eventName: input.eventName } : {}),
      ...(input.businessType !== undefined ? { businessType: input.businessType } : {}),
      ...(input.transactionId !== undefined ? { transactionId: input.transactionId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.flowInstanceId !== undefined ? { flowInstanceId: input.flowInstanceId } : {}),
      ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
      ...(input.data !== undefined ? { data: input.data } : {}),
    } satisfies AuditJournalRecord;
    await this.repository.append(record);
    return record;
  }
}
