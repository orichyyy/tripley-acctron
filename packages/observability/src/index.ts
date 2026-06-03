import type { JournalPort } from "@tripley-acctron/contracts";
import type { ILogger, ILoggerMetadata } from "@tripley-kit/logger";

export type InteractionSource = "touchscreen" | "pinpad";

export interface InteractionRecord {
  action: string;
  code: string;
  source: InteractionSource;
  traceId?: string;
}

export class InteractionRecorder {
  public constructor(
    private readonly logger: ILogger,
    private readonly journal: JournalPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async record(record: InteractionRecord): Promise<void> {
    const data = { action: record.action, code: record.code, source: record.source };
    const metadata: ILoggerMetadata = {
      eventId: "customer.interaction.selected",
      module: "interaction",
      action: record.action,
      data,
    };
    if (record.traceId !== undefined) {
      metadata.traceId = record.traceId;
    }
    this.logger.info("Customer interaction selected", metadata);
    await this.journal.append({
      eventId: "customer.interaction.selected",
      timestamp: this.now().toISOString(),
      ...(record.traceId === undefined ? {} : { traceId: record.traceId }),
      data,
    });
  }
}

export function logError(
  logger: ILogger,
  message: string,
  error: unknown,
  metadata: ILoggerMetadata,
): void {
  logger.error(message, error instanceof Error ? error : new Error(String(error)), metadata);
}
