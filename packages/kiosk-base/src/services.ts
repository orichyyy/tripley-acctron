import { FrameworkError } from "@tripley/web-container-errors";
import type { JsonValue, Metadata } from "@tripley/web-container-types";

import type { AuditJournalRecord, AuditJournalRepository } from "./repositories";

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

export type AccessibilityMode = "standard" | "blind" | "lowVision" | "headphone";

export interface AccessibilityState {
  readonly mode: AccessibilityMode;
  readonly verbosePrompts: boolean;
  readonly ttsEnabled: boolean;
}

export class AccessibilityService {
  private state: AccessibilityState = {
    mode: "standard",
    ttsEnabled: false,
    verbosePrompts: false,
  };

  public getState(): AccessibilityState {
    return this.state;
  }

  public setMode(mode: AccessibilityMode): AccessibilityState {
    this.state =
      mode === "blind" || mode === "headphone"
        ? { mode, ttsEnabled: true, verbosePrompts: true }
        : { mode, ttsEnabled: mode === "lowVision", verbosePrompts: false };
    return this.state;
  }
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface BusinessCalendar {
  isBusinessDay(date: Date): boolean;
  isWithinWindow(date: Date, windowId: string): boolean;
}

export interface BusinessCalendarOptions {
  readonly businessDays?: readonly number[] | undefined;
  readonly windows?:
    | Record<string, { readonly startHour: number; readonly endHour: number }>
    | undefined;
}

export class DefaultBusinessCalendar implements BusinessCalendar {
  private readonly businessDays: readonly number[];
  private readonly windows: Record<
    string,
    { readonly startHour: number; readonly endHour: number }
  >;

  public constructor(options: BusinessCalendarOptions = {}) {
    this.businessDays = options.businessDays ?? [1, 2, 3, 4, 5];
    this.windows = options.windows ?? {
      default: { endHour: 18, startHour: 9 },
    };
  }

  public isBusinessDay(date: Date): boolean {
    return this.businessDays.includes(date.getDay());
  }

  public isWithinWindow(date: Date, windowId: string): boolean {
    const window = this.windows[windowId] ?? this.windows.default;
    if (!window) {
      return true;
    }

    const hour = date.getHours();
    return hour >= window.startHour && hour < window.endHour;
  }
}

export interface FeatureFlagRecord {
  readonly id: string;
  readonly enabled: boolean;
  readonly metadata?: Metadata | undefined;
}

export class FeatureFlagService {
  private readonly flags = new Map<string, FeatureFlagRecord>();

  public constructor(flags: readonly FeatureFlagRecord[] = []) {
    for (const flag of flags) {
      this.flags.set(flag.id, flag);
    }
  }

  public isEnabled(id: string): boolean {
    return this.flags.get(id)?.enabled ?? false;
  }

  public set(id: string, enabled: boolean, metadata?: Metadata): void {
    this.flags.set(id, { id, enabled, metadata });
  }

  public list(): FeatureFlagRecord[] {
    return [...this.flags.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
}

export interface PromptCatalogEntry {
  readonly key: string;
  readonly locale: string;
  readonly text: string;
}

export class PromptCatalog {
  private readonly prompts = new Map<string, string>();

  public constructor(entries: readonly PromptCatalogEntry[] = []) {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  public register(entry: PromptCatalogEntry): void {
    this.prompts.set(promptKey(entry.locale, entry.key), entry.text);
  }

  public translate(key: string, locale: string, params: Record<string, unknown> = {}): string {
    const template =
      this.prompts.get(promptKey(locale, key)) ?? this.prompts.get(promptKey("en", key));
    if (!template) {
      return key;
    }

    return template.replace(/\{([^}]+)\}/g, (_match, name: string) => String(params[name] ?? ""));
  }
}

export interface HealthCheckResult {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly message?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}

export interface HealthCheck {
  readonly id: string;
  run(): Promise<HealthCheckResult>;
}

export class HealthCheckCenter {
  private readonly checks = new Map<string, HealthCheck>();

  public register(check: HealthCheck): void {
    if (this.checks.has(check.id)) {
      throw new FrameworkError({
        category: "extension",
        code: "healthCheck.duplicate",
        message: `Health check already registered: ${check.id}`,
        metadata: { healthCheckId: check.id },
      });
    }

    this.checks.set(check.id, check);
  }

  public async runAll(): Promise<HealthCheckResult[]> {
    return Promise.all([...this.checks.values()].map((check) => check.run()));
  }
}

export type OperationStatus = "started" | "completed" | "failed";

export interface OperationLedgerRecord {
  readonly idempotencyKey: string;
  readonly operationType: string;
  readonly status: OperationStatus;
  readonly result?: JsonValue | undefined;
  readonly errorCode?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperationLedger {
  start(operationType: string, idempotencyKey: string): Promise<OperationLedgerRecord>;
  complete(idempotencyKey: string, result?: JsonValue): Promise<OperationLedgerRecord>;
  fail(idempotencyKey: string, errorCode: string): Promise<OperationLedgerRecord>;
  get(idempotencyKey: string): Promise<OperationLedgerRecord | null>;
}

export class InMemoryOperationLedger implements OperationLedger {
  private readonly records = new Map<string, OperationLedgerRecord>();

  public constructor(private readonly clock: Clock = systemClock) {}

  public async start(
    operationType: string,
    idempotencyKey: string,
  ): Promise<OperationLedgerRecord> {
    const existing = this.records.get(idempotencyKey);
    if (existing) {
      return existing;
    }

    const now = this.clock.now().toISOString();
    const record: OperationLedgerRecord = {
      createdAt: now,
      idempotencyKey,
      operationType,
      status: "started",
      updatedAt: now,
    };
    this.records.set(idempotencyKey, record);
    return record;
  }

  public async complete(
    idempotencyKey: string,
    result?: JsonValue,
  ): Promise<OperationLedgerRecord> {
    return this.update(idempotencyKey, { result, status: "completed" });
  }

  public async fail(idempotencyKey: string, errorCode: string): Promise<OperationLedgerRecord> {
    return this.update(idempotencyKey, { errorCode, status: "failed" });
  }

  public async get(idempotencyKey: string): Promise<OperationLedgerRecord | null> {
    return this.records.get(idempotencyKey) ?? null;
  }

  private update(
    idempotencyKey: string,
    patch: Pick<OperationLedgerRecord, "status"> & Partial<OperationLedgerRecord>,
  ): OperationLedgerRecord {
    const existing = this.records.get(idempotencyKey);
    if (!existing) {
      throw new FrameworkError({
        category: "dependency",
        code: "operationLedger.missing",
        message: `Operation ledger record is missing: ${idempotencyKey}`,
        metadata: { idempotencyKey },
      });
    }

    const updated = { ...existing, ...patch, updatedAt: this.clock.now().toISOString() };
    this.records.set(idempotencyKey, updated);
    return updated;
  }
}

export interface OutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly payload: JsonValue;
  readonly status: "pending" | "sent" | "failed";
  readonly createdAt: string;
}

export interface Outbox {
  enqueue(message: Omit<OutboxMessage, "createdAt" | "status">): Promise<OutboxMessage>;
  listPending(): Promise<OutboxMessage[]>;
  markSent(id: string): Promise<void>;
}

export const kioskOperationLedgerTableSql = `CREATE TABLE IF NOT EXISTS kiosk_operation_ledger (
  idempotency_key TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

export const kioskOutboxTableSql = `CREATE TABLE IF NOT EXISTS kiosk_outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);`;

const promptKey = (locale: string, key: string): string => `${locale}:${key}`;
