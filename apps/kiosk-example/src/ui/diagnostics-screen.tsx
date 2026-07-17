import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { ExampleApplicationRuntime } from "../runtime/types";

export const DiagnosticsScreen = ({ application }: { application: ExampleApplicationRuntime }) => {
  const [readiness, setReadiness] = useState(() => application.runtime.snapshot().readiness);
  useEffect(() => application.runtime.subscribeReadiness(setReadiness), [application.runtime]);
  return (
    <main className="diagnostics-shell">
      <header>
        <div>
          <p className="kicker">Operator surface</p>
          <h1>Capability matrix</h1>
        </div>
        <Link to="/kiosk">Return to kiosk</Link>
      </header>
      <section className="diagnostic-grid">
        <article>
          <span>Runtime mode</span>
          <strong>{application.mode}</strong>
          <small>{readiness.status}</small>
        </article>
        <article>
          <span>Hostd transport</span>
          <strong>{application.diagnostics.hostdUrl ?? "not used"}</strong>
          <small>{application.diagnostics.bootstrapError ?? "No bootstrap error"}</small>
        </article>
        {Object.entries(application.diagnostics.logicalServices).map(([module, logicalName]) => (
          <article key={module}>
            <span>{module.toUpperCase()} logical service</span>
            <strong>{logicalName}</strong>
            <small>Configuration-owned mapping</small>
          </article>
        ))}
        {application.diagnostics.health ? (
          <article>
            <span>Device health</span>
            <strong>
              {application.diagnostics.health.checks
                .map((check) => `${check.id}: ${check.status}`)
                .join(" / ")}
            </strong>
            <small>Last checked {application.diagnostics.health.checkedAt}</small>
          </article>
        ) : null}
      </section>
      <section className="method-table">
        <h2>Entry method availability</h2>
        {readiness.entryMethods.map((entry) => (
          <div key={entry.id}>
            <strong>
              {entry.id}@{entry.version}
            </strong>
            <span>{entry.available ? "available" : entry.reasonCode}</span>
          </div>
        ))}
      </section>
      <p className="diagnostic-note">
        Diagnostics contain capability summaries only. Credential values, PIN blocks, QR payloads
        and device raw fields are excluded.
      </p>
      <button
        className="cancel-action"
        onClick={() =>
          void application.commands.execute(
            "kiosk.runtime.reboot",
            {},
            { mode: application.mode === "hostd" ? "memory" : "hostd" },
          )
        }
        type="button"
      >
        Reboot into {application.mode === "hostd" ? "memory" : "hostd"} mode
      </button>
    </main>
  );
};
