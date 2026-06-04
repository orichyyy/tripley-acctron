export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

export type RedactionKind =
  | "pin"
  | "password"
  | "account"
  | "accountNo"
  | "card"
  | "cardNo"
  | "idNo"
  | "barcode"
  | "customerInput";

export interface RedactionService {
  redact(eventName: string, payload: unknown, redactAs?: RedactionKind): unknown;
  redactValue(redactAs: RedactionKind, value: unknown): unknown;
  pinpadKey(key: string, redactAs?: RedactionKind): string;
  accountNo(value: string): string;
  cardNo(value: string): string;
  barcode(value: string): string;
}

export interface JournalEntry {
  type: string;
  timestamp?: number;
  transactionId?: string;
  data?: unknown;
}

export interface ElectronicJournal {
  write(entry: JournalEntry): Promise<void>;
}

export interface AuditPrompt {
  promptId: string;
  flowId?: string;
  nodeId?: string;
  stepId?: string;
  screen?: string;
  data?: Record<string, unknown>;
}

export interface AuditChoice {
  promptId?: string;
  flowId?: string;
  nodeId?: string;
  stepId?: string;
  choiceId: string;
  source: string;
  data?: Record<string, unknown>;
}

export interface AuditInput {
  promptId?: string;
  flowId?: string;
  nodeId?: string;
  stepId?: string;
  source: string;
  inputType: string;
  value?: unknown;
  redactAs?: RedactionKind;
  data?: Record<string, unknown>;
}

export interface InteractionAuditService {
  beginPrompt(prompt: AuditPrompt): Promise<void>;
  recordCustomerChoice(choice: AuditChoice): Promise<void>;
  recordCustomerInput(input: AuditInput): Promise<void>;
  endPrompt(promptId: string): Promise<void>;
}
