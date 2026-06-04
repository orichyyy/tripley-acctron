import { describe, expect, test } from "vitest";
import { InputSources } from "./input-sources";
import { defineChoiceStep } from "./choice-step";
import { defineConfirmStep } from "./confirm-step";
import { createStandardStepTestKit, flushPromises, journalEntries } from "./standard-step-test-kit";
import { defineTextInputStep } from "./text-input-step";

describe("standard step audit", () => {
  test("standard steps write redacted audit records", async () => {
    const text = createStandardStepTestKit({
      input: defineTextInputStep({
        id: "pin",
        screen: "input",
        value: { redactAs: "pin" },
        sources: [InputSources.pinpad.numeric()],
        routes: { accepted: "Valid" },
      }),
    });
    const textRun = text.flow.run("demo");
    for (const key of ["1", "2", "3", "4", "enter"] as const) {
      text.devices.pinpad.press(key);
      await flushPromises();
    }
    await expect(textRun).resolves.toEqual({ flowId: "demo", endName: "Valid" });
    expect(journalEntries(text).some((entry) => entry.type === "interaction.input")).toBe(true);
    expect(JSON.stringify(journalEntries(text))).not.toContain("1234");

    const choice = createStandardStepTestKit({
      input: defineChoiceStep({
        id: "choice",
        screen: "choice",
        choices: [{ id: "saving", label: "Saving", route: "Saving" }],
      }),
    });
    const choiceRun = choice.flow.run("demo");
    choice.devices.pinpad.press("f1");
    await expect(choiceRun).resolves.toEqual({ flowId: "demo", endName: "Saving" });
    expect(journalEntries(choice)).toContainEqual(
      expect.objectContaining({
        type: "interaction.choice",
        data: expect.objectContaining({ choiceId: "saving", source: "pinpad.functionKeys" }),
      }),
    );

    const confirm = createStandardStepTestKit({
      input: defineConfirmStep({
        id: "confirm",
        screen: "confirm",
        routes: { confirmed: "Confirmed" },
      }),
    });
    const confirmRun = confirm.flow.run("demo");
    await flushPromises();
    confirm.ui.emitAction("confirm", { type: "submit" });
    await expect(confirmRun).resolves.toEqual({ flowId: "demo", endName: "Confirmed" });
    expect(journalEntries(confirm)).toContainEqual(
      expect.objectContaining({
        type: "interaction.choice",
        data: expect.objectContaining({ choiceId: "confirm", source: "ui.confirmCancel" }),
      }),
    );
  });
});
