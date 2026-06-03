import type { LogEntry, Logger, LogLevel } from "@tripley-acctron/contracts";

export class InMemoryLogger implements Logger {
  public readonly entries: LogEntry[] = [];

  public debug(message: string, attributes?: Record<string, unknown>): void {
    this.write("debug", message, attributes);
  }

  public info(message: string, attributes?: Record<string, unknown>): void {
    this.write("info", message, attributes);
  }

  public warn(message: string, attributes?: Record<string, unknown>): void {
    this.write("warn", message, attributes);
  }

  public error(message: string, attributes?: Record<string, unknown>): void {
    this.write("error", message, attributes);
  }

  private write(level: LogLevel, message: string, attributes?: Record<string, unknown>): void {
    const entry: LogEntry = { level, message, timestamp: Date.now() };
    if (attributes) {
      entry.attributes = attributes;
    }
    this.entries.push(entry);
  }
}
