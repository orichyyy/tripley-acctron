import { describe, expect, it } from "vitest";
import {
  ConsoleLogger,
  LogRedactor,
  TripleyKitLoggerAdapter,
  createConsoleFallbackLogger,
} from "./index";
import type { AppLogRecord, ConsoleLogSink } from "./index";

const createMemorySink = (): {
  readonly records: AppLogRecord[];
  readonly sink: ConsoleLogSink;
} => {
  const records: AppLogRecord[] = [];
  const write = (record: AppLogRecord) => records.push(record);
  return {
    records,
    sink: {
      debug: write,
      error: write,
      info: write,
      trace: write,
      warn: write,
    },
  };
};

describe("ConsoleLogger", () => {
  it("requires metadata.eventId and metadata.module", () => {
    const { sink } = createMemorySink();
    const logger = new ConsoleLogger({ sink });

    expect(() =>
      logger.info("missing event id", {
        eventId: "",
        module: "test",
      }),
    ).toThrow("metadata.eventId");
  });

  it("redacts sensitive metadata and raw user identifiers", () => {
    const { records, sink } = createMemorySink();
    const logger = new ConsoleLogger({ sink });

    logger.info("redacted", {
      eventId: "test.redacted",
      module: "test",
      userId: "raw-user-1",
      data: {
        nested: {
          accessToken: "secret-token",
          pin: "1234",
        },
      },
    });

    expect(records[0]?.metadata?.userId).toBe("[REDACTED]");
    expect(records[0]?.metadata?.data).toMatchObject({
      nested: {
        accessToken: "[REDACTED]",
        pin: "[REDACTED]",
      },
    });
  });

  it("emits a warning when creating the console fallback logger", () => {
    const { records, sink } = createMemorySink();

    createConsoleFallbackLogger("native fs missing", { sink });

    expect(records[0]).toMatchObject({
      level: "WARN",
      metadata: {
        eventId: "logging.file.unavailable",
        module: "logging",
      },
    });
  });
});

describe("TripleyKitLoggerAdapter", () => {
  it("passes only safe framework metadata to the logger boundary", () => {
    const calls: unknown[] = [];
    const adapter = new TripleyKitLoggerAdapter({
      info: (_message, metadata) => calls.push(metadata),
    });

    adapter.info("adapter", {
      eventId: "adapter.info",
      module: "logging",
      userId: "hashed:abc",
      data: {
        password: "secret",
      },
    });

    expect(calls[0]).toMatchObject({
      data: { password: "[REDACTED]" },
      eventId: "adapter.info",
      module: "logging",
      userId: "hashed:abc",
    });
  });
});

describe("LogRedactor", () => {
  it("allows custom sensitive key rules", () => {
    const redactor = new LogRedactor({ sensitiveKeys: ["credential"] });

    expect(
      redactor.redactMetadata({
        eventId: "redactor.custom",
        module: "logging",
        data: { credentialValue: "secret" },
      }).data,
    ).toEqual({ credentialValue: "[REDACTED]" });
  });
});
