import { describe, expect, test } from "vitest";
import { DefaultInteractionAuditService } from "./interaction-audit-service";
import { InMemoryElectronicJournal } from "./in-memory-electronic-journal";
import { InMemoryLogger } from "./in-memory-logger";
import { DefaultRedactionService } from "./redaction";

describe("interaction audit service", () => {
  test("writes prompt, choice, and redacted input to log and journal", async () => {
    const logger = new InMemoryLogger();
    const journal = new InMemoryElectronicJournal();
    const redaction = new DefaultRedactionService();
    const audit = new DefaultInteractionAuditService({ logger, journal, redaction });

    await audit.beginPrompt({ promptId: "pin", stepId: "pin", screen: "pinScreen" });
    await audit.recordCustomerChoice({
      promptId: "pin",
      stepId: "pin",
      choiceId: "continue",
      source: "ui.choice",
    });
    await audit.recordCustomerInput({
      promptId: "pin",
      stepId: "pin",
      source: "pinpad.numeric",
      inputType: "append",
      value: "123456",
      redactAs: "pin",
    });
    await audit.endPrompt("pin");

    expect(journal.entries.map((entry) => entry.type)).toEqual([
      "interaction.prompt.begin",
      "interaction.choice",
      "interaction.input",
      "interaction.prompt.end",
    ]);
    expect(JSON.stringify(journal.entries)).not.toContain("123456");
    expect(JSON.stringify(logger.entries)).not.toContain("123456");
  });

  test("masks account, card, and barcode values", () => {
    const redaction = new DefaultRedactionService();

    expect(redaction.accountNo("1234567890")).toBe("12******90");
    expect(redaction.cardNo("6217000011112222")).toBe("62************22");
    expect(redaction.barcode("ACCOUNT:123456")).toBe("AC**********56");
  });
});
