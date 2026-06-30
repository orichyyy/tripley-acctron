import { corePackage } from "@tripley/web-container-core";
import {
  addProjectExtension,
  createProjectSpecificInputExtension,
  createWithdrawalExampleProject,
} from "@tripley/web-container-kiosk-base";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Missing #app root element.");
}
const root = app;

void bootstrap();

async function bootstrap(): Promise<void> {
  const project = createWithdrawalExampleProject([createProjectSpecificInputExtension()]);
  const blueprint = addProjectExtension(project.blueprint, {
    id: "bank-demo",
    inputSources: [project.scenario.extensionKind],
  });
  const transaction = await project.runCommand();
  const validationFailure = await project.runValidationFailure();
  const securePinRun = await project.runSecurePin();

  root.innerHTML = `
  <section class="hero" aria-labelledby="app-title">
    <div class="hero-copy">
      <p class="eyebrow">Tripley kiosk base</p>
      <h1 id="app-title">Withdrawal flow, wired through extension seams.</h1>
      <p class="lede">
        This example is driven by @tripley/web-container-kiosk-base exports: command invocation,
        dynamic user input, device input adapters, audit, scoped cleanup, and safe logging metadata.
      </p>
    </div>
    <aside class="status-card" aria-label="Runtime summary">
      <span>Core</span>
      <strong>${corePackage.name}</strong>
      <span>Preset</span>
      <strong>${blueprint.preset.id}@${blueprint.preset.version}</strong>
    </aside>
  </section>

  <section class="grid" aria-label="Kiosk capabilities">
    ${renderPanel("Command", [
      `commandId: ${project.scenario.commandId}`,
      `transaction: ${transaction.id}`,
      `audit: ${project.scenario.auditEventId}`,
    ])}
    ${renderPanel("Flow policy", [
      `flowId: ${project.scenario.flowId}`,
      `timeout: ${project.scenario.timeoutMs}ms`,
      `interrupt: ${project.scenario.interruptId}`,
    ])}
    ${renderPanel("User input", [
      `dynamic node: ${project.scenario.dynamicUserInputNodeId}`,
      `optional QR: ${String(project.scenario.optionalBarcodeQrInput)}`,
      `validation feedback: ${project.scenario.validationFailureFeedbackKey}`,
    ])}
    ${renderPanel("Secure PIN", [
      `node: ${project.scenario.securePinNodeId}`,
      `safe log event: ${project.scenario.loggingEventId}`,
      `run status: ${readStatus(securePinRun)}`,
    ])}
    ${renderPanel("Scoped lifecycle", [
      `reset reason: ${project.scenario.scopedStoreResetReason}`,
      `validation result: ${readResultType(validationFailure)}`,
      `feedback: ${readLastFeedback(validationFailure)}`,
    ])}
    ${renderPanel("Project extension", [
      "plugin: bank-demo",
      `input source: ${project.scenario.extensionKind}`,
      "core modified: no",
    ])}
  </section>

  <section class="blueprint" aria-label="Blueprint">
    <h2>Blueprint extension points</h2>
    <p>${blueprint.extensionPoints.join(" / ")}</p>
  </section>
`;
}

function renderPanel(title: string, lines: readonly string[]): string {
  return `
    <article class="panel">
      <h2>${title}</h2>
      <ul>
        ${lines.map((line) => `<li>${line}</li>`).join("")}
      </ul>
    </article>
  `;
}

function readStatus(value: unknown): string {
  return readRecord(value).status ?? "unknown";
}

function readResultType(value: unknown): string {
  const result = readRecord(readRecord(value).result);
  return result.type ?? "unknown";
}

function readLastFeedback(value: unknown): string {
  const feedback = readRecord(value).uiFeedback;
  if (!Array.isArray(feedback)) {
    return "none";
  }

  const last = readRecord(feedback.at(-1));
  return last.messageKey ?? last.status ?? "none";
}

function readRecord(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}
