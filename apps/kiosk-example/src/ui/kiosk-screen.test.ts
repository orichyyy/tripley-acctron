import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { createExampleApplicationRuntime } from "../runtime/create-runtime";
import type { ExampleApplicationRuntime } from "../runtime/types";
import { KioskScreen } from "./kiosk-screen";

describe("KioskScreen", () => {
  it("renders idle entries and dynamic reservation inputs without retaining values", async () => {
    const application = await createExampleApplicationRuntime({ mode: "memory" });
    expect(render(application)).toContain("Choose how to begin");

    const result = application.runtime.start({
      entryMethodId: "reservation",
      intentId: "render-reservation",
    });
    await waitForPrompt(application, "reservation.number");
    const numberMarkup = render(application);
    expect(numberMarkup).toContain('inputMode="numeric"');
    expect(numberMarkup).toContain('maxLength="12"');
    await application.commands.execute("kiosk.input.submit", {}, { value: "987654" });

    await waitForPrompt(application, "reservation.secret");
    const secretMarkup = render(application);
    expect(secretMarkup).toContain('type="password"');
    expect(secretMarkup).not.toContain("987654");

    await application.runtime.interrupt("test.cleanup");
    await expect(result).resolves.toMatchObject({ status: "interrupted" });
    await application.dispose();
  });

  it("renders memory controls for QR and secure PIN device adapters", async () => {
    const application = await createExampleApplicationRuntime({ mode: "memory" });
    const result = application.runtime.start({ entryMethodId: "qr", intentId: "render-qr" });

    await waitForPrompt(application, "entry.qr.scan");
    expect(render(application)).toContain('type="text"');
    await application.commands.execute(
      "kiosk.input.submit",
      {},
      { value: "acctron://withdrawal/render" },
    );
    await waitForPrompt(application, "withdrawal.amount");
    await application.commands.execute("kiosk.input.submit", {}, { value: "600" });

    await waitForPrompt(application, "pin.enter");
    expect(render(application)).toContain("Confirm on simulated secure device");

    await application.runtime.interrupt("test.cleanup");
    await expect(result).resolves.toMatchObject({ status: "interrupted" });
    await application.dispose();
  });
});

const render = (application: ExampleApplicationRuntime): string =>
  renderToStaticMarkup(
    createElement(MemoryRouter, undefined, createElement(KioskScreen, { application })),
  );

const waitForPrompt = async (
  application: ExampleApplicationRuntime,
  promptId: string,
): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (application.runtime.snapshot().operation.promptId !== promptId) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for prompt: ${promptId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
