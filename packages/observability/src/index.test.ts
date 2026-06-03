import { noopLogger } from "@tripley-kit/logger";
import { describe, expect, it } from "vitest";
import { MemoryJournal } from "@tripley-acctron/testing";
import { InteractionRecorder } from "./index.js";

describe("InteractionRecorder", () => {
  it("writes safe interaction codes to the electronic journal", async () => {
    const journal = new MemoryJournal();
    const recorder = new InteractionRecorder(noopLogger, journal, () => new Date(0));
    await recorder.record({ action: "confirm-more-time", code: "yes", source: "touchscreen" });
    expect(journal.entries).toEqual([
      {
        eventId: "customer.interaction.selected",
        timestamp: "1970-01-01T00:00:00.000Z",
        data: { action: "confirm-more-time", code: "yes", source: "touchscreen" },
      },
    ]);
  });
});
