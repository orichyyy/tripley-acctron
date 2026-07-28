import type { InputInteractionIdentity } from "@tripley-kit/web-container-device-core";
import type { OperationViewState, RuntimeReadiness } from "@tripley-kit/web-container-kiosk-runtime";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import type { ExampleApplicationRuntime } from "../runtime/types";

export const KioskScreen = ({ application }: { application: ExampleApplicationRuntime }) => {
  const projected = useStore(
    application.store,
    (state) => state[application.operationStateKey] as OperationViewState | undefined,
  );
  const operation = projected ?? application.runtime.snapshot().operation;
  const readiness = useRuntimeReadiness(application);
  const inputRef = useRef<HTMLInputElement>(null);
  const [commandError, setCommandError] = useState<string>();

  useEffect(
    () => () => {
      void application.runtime.interrupt("route.exit");
    },
    [application],
  );

  const execute = async (commandId: string, input: unknown) => {
    setCommandError(undefined);
    try {
      await application.commands.execute(commandId, {}, input);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const secureConfirmation =
      application.mode === "memory" && operation.safeData?.secureDevice === true;
    void execute("kiosk.input.submit", {
      identity: operation.safeData
        ?.interactionIdentity as InputInteractionIdentity | undefined,
      intentId: firstString(operation.safeData?.allowedIntentIds),
      secureConfirmation,
      value: secureConfirmation ? undefined : (inputRef.current?.value ?? ""),
    });
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <main className="terminal-shell">
      <header className="terminal-header">
        <div className="brand-lockup">
          <span className="brand-mark">T</span>
          <div>
            <strong>TRIPLEY ACCTRON</strong>
            <small>Customer terminal / {application.mode}</small>
          </div>
        </div>
        <nav>
          <Link to="/diagnostics">System diagnostics</Link>
        </nav>
      </header>
      <section className="operation-stage" data-phase={operation.phase}>
        <div className="status-rail">
          <span>Runtime</span>
          <strong>{readiness.status}</strong>
          <span>Operation</span>
          <strong>{operation.phase}</strong>
          <span>Revision</span>
          <strong>{String(operation.revision).padStart(3, "0")}</strong>
        </div>
        <div className="stage-content">
          <p className="kicker">Secure self-service banking</p>
          {operation.phase === "idle" ||
          ["completed", "failed", "interrupted"].includes(operation.phase) ? (
            <IdlePanel application={application} execute={execute} />
          ) : null}
          {operation.phase === "waitingCredential" ? (
            <Prompt
              title="Present your credential"
              detail="Follow the illuminated device prompt."
            />
          ) : null}
          {operation.phase === "collectingInput" ? (
            <form className="input-panel" onSubmit={submit}>
              <Prompt
                title={promptTitle(operation.promptId)}
                detail={
                  operation.safeData?.externalDevice
                    ? "Complete this step on the secure device."
                    : "Enter the requested information, then continue."
                }
              />
              {application.mode === "memory" && operation.safeData?.secureDevice ? (
                <button className="primary-action" type="submit">
                  Confirm on simulated secure device
                </button>
              ) : operation.safeData?.externalDevice && application.mode === "hostd" ? (
                <div className="device-pulse" aria-label="Waiting for external device">
                  <i />
                  <i />
                  <i />
                </div>
              ) : (
                <>
                  <input
                    ref={inputRef}
                    inputMode={operation.safeData?.inputMode === "numeric" ? "numeric" : "text"}
                    minLength={numberOrUndefined(operation.safeData?.minLength)}
                    maxLength={numberOrUndefined(operation.safeData?.maxLength)}
                    aria-label={promptTitle(operation.promptId)}
                    type={operation.safeData?.secure ? "password" : "text"}
                  />
                  <button className="primary-action" type="submit">
                    Continue
                  </button>
                </>
              )}
            </form>
          ) : null}
          {operation.phase === "authenticating" ? (
            <Prompt title="Authenticating" detail="Your credentials are being verified." />
          ) : null}
          {operation.phase === "processing" ? (
            <Prompt title="Processing withdrawal" detail="Keep your card in the terminal." />
          ) : null}
          {operation.phase === "takeMedia" ? (
            <form onSubmit={submit}>
              <Prompt title="Take your card" detail="Remove your card before leaving." />
              {application.mode === "memory" ? (
                <button className="safety-action" type="submit">
                  Simulate taking card
                </button>
              ) : (
                <div className="device-pulse">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </form>
          ) : null}
          {operation.phase === "intervention" ? (
            <Prompt
              title="Terminal unavailable"
              detail="Customer media status requires operator intervention."
            />
          ) : null}
          {operation.feedback ? (
            <div className="feedback-banner" role="alert">
              {operation.feedback.messageKey}
            </div>
          ) : null}
          {commandError ? (
            <div className="feedback-banner" role="alert">
              {commandError}
            </div>
          ) : null}
          {!["idle", "completed", "failed", "interrupted", "intervention"].includes(
            operation.phase,
          ) ? (
            <button
              className="cancel-action"
              onClick={() => void execute("kiosk.operation.cancel", {})}
              type="button"
            >
              Cancel operation
            </button>
          ) : null}
        </div>
      </section>
      <footer>
        <span>PCI-safe projection</span>
        <span>Flow / Command / Device abstraction</span>
        <span>{new Date().getFullYear()}</span>
      </footer>
    </main>
  );
};

const IdlePanel = ({
  application,
  execute,
}: {
  application: ExampleApplicationRuntime;
  execute(commandId: string, input: unknown): Promise<void>;
}) => {
  const readiness = useRuntimeReadiness(application);
  return (
    <div className="idle-panel">
      <h1>Choose how to begin.</h1>
      <p>One operation. One credential path. No silent device fallback.</p>
      <div className="entry-grid">
        {readiness.entryMethods.map((entry) => (
          <button
            key={entry.id}
            type="button"
            disabled={!entry.available}
            onClick={() =>
              void execute("withdrawal.start", {
                entryMethodId: entry.id,
                intentId: `${entry.id}-${Date.now()}`,
              })
            }
          >
            <span>{entry.labelKey.replace("entry.", "").replaceAll(".", " ")}</span>
            <small>{entry.available ? "Available" : entry.reasonCode}</small>
          </button>
        ))}
      </div>
      {readiness.status === "failed" ? (
        <div className="feedback-banner">
          {application.diagnostics.bootstrapError ?? "No entry method is currently available."}
        </div>
      ) : null}
    </div>
  );
};

const Prompt = ({ title, detail }: { title: string; detail: string }) => (
  <div className="prompt-block">
    <h1>{title}</h1>
    <p>{detail}</p>
  </div>
);
const promptTitle = (id?: string) =>
  ({
    "withdrawal.amount": "Enter withdrawal amount",
    "pin.enter": "Enter secure PIN",
    "entry.qr.scan": "Scan withdrawal QR",
    "reservation.number": "Enter reservation number",
    "reservation.secret": "Enter reservation password",
    "card.present": "Insert your card",
    "card.take": "Take your card",
  })[id ?? ""] ?? "Continue";
const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;
const firstString = (value: unknown): string | undefined =>
  Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;

const useRuntimeReadiness = (application: ExampleApplicationRuntime): RuntimeReadiness => {
  const [readiness, setReadiness] = useState(() => application.runtime.snapshot().readiness);
  useEffect(() => application.runtime.subscribeReadiness(setReadiness), [application.runtime]);
  return readiness;
};
