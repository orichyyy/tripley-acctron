import type { OperationViewState } from "@tripley-kit/web-container-kiosk-runtime";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import type { WithdrawalDiagnosticsSnapshot } from "../runtime/operator-diagnostics";
import type { ExampleApplicationRuntime } from "../runtime/types";
import "./diagnostics.css";

export const DiagnosticsScreen = ({ application }: { application: ExampleApplicationRuntime }) => {
  const [readiness, setReadiness] = useState(() => application.runtime.snapshot().readiness);
  const [withdrawal, setWithdrawal] = useState<WithdrawalDiagnosticsSnapshot>(() =>
    application.diagnostics.withdrawal.snapshot(),
  );
  const operation = useStore(
    application.store,
    (state) => state[application.operationStateKey] as OperationViewState | undefined,
  );
  useEffect(() => application.runtime.subscribeReadiness(setReadiness), [application.runtime]);
  useEffect(
    () => application.diagnostics.withdrawal.subscribe(setWithdrawal),
    [application.diagnostics.withdrawal],
  );

  return (
    <main className="diagnostics-shell">
      <header>
        <div>
          <p className="kicker">Operator surface / safe projection</p>
          <h1>Runtime evidence</h1>
        </div>
        <Link to="/kiosk">Return to kiosk</Link>
      </header>

      <section aria-label="Runtime status" className="diagnostic-grid">
        <DiagnosticCard label="Runtime mode" value={application.mode} detail={readiness.status} />
        <DiagnosticCard
          label="Active flow"
          value={operation?.phase ?? "idle"}
          detail={operation?.operationId ?? "No active operation"}
        />
        <DiagnosticCard
          label="Media custody"
          value={operation?.mediaCustody ?? "none"}
          detail={operation?.feedback?.reasonCode ?? "No active feedback"}
        />
        <DiagnosticCard
          label="Hostd transport"
          value={application.diagnostics.hostdUrl ?? "not used"}
          detail={application.diagnostics.bootstrapError ?? "No bootstrap error"}
        />
        {Object.entries(application.diagnostics.logicalServices).map(([module, logicalName]) => (
          <DiagnosticCard
            detail="Configuration-owned mapping"
            key={module}
            label={`${module.toUpperCase()} logical service`}
            value={logicalName}
          />
        ))}
        {application.diagnostics.health ? (
          <DiagnosticCard
            detail={`Last checked ${application.diagnostics.health.checkedAt}`}
            label="Device health"
            value={application.diagnostics.health.checks
              .map((check) => `${check.id}: ${check.status}`)
              .join(" / ")}
          />
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

      <WithdrawalEvidence snapshot={withdrawal} />

      <p className="diagnostic-note">
        This surface is a one-way safe projection. Credential values, PAN, Track 2, PIN blocks,
        QR payloads, host payloads and device raw fields are excluded by construction.
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

const DiagnosticCard = ({
  detail,
  label,
  value,
}: {
  readonly detail: string;
  readonly label: string;
  readonly value: string;
}) => (
  <article>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>
);

const WithdrawalEvidence = ({ snapshot }: { snapshot: WithdrawalDiagnosticsSnapshot }) => {
  const evidence = snapshot.latest;
  if (!evidence) {
    return (
      <section aria-live="polite" className="evidence-panel evidence-panel--empty">
        <p className="kicker">Withdrawal evidence / rev {snapshot.revision}</p>
        <h2>No terminal withdrawal recorded</h2>
        <p>Evidence appears here after the BSP orchestration reaches a terminal outcome.</p>
      </section>
    );
  }

  return (
    <section
      aria-live="polite"
      className={`evidence-panel evidence-panel--${evidence.status}`}
    >
      <div className="evidence-heading">
        <div>
          <p className="kicker">Withdrawal evidence / rev {snapshot.revision}</p>
          <h2>{evidence.failureReason}</h2>
        </div>
        <strong className="evidence-operation">{evidence.operationId}</strong>
      </div>
      <dl className="evidence-facts">
        <EvidenceFact label="Outcome" value={`${evidence.status} / ${evidence.outcomeReason}`} />
        <EvidenceFact label="Host" value={`${evidence.host.status} / ${evidence.host.protocol}`} />
        <EvidenceFact label="Card custody" value={evidence.card.status} />
        <EvidenceFact
          label="Cash custody"
          value={`${evidence.cash.custody} / present:${String(evidence.cash.presented)}`}
        />
        <EvidenceFact
          label="Cash terminal"
          value={`taken:${String(evidence.cash.taken)} / retracted:${String(evidence.cash.retracted)}`}
        />
        <EvidenceFact
          label="Reconciliation"
          value={evidence.requiresManualReconciliation ? "manual review required" : "not required"}
        />
        <EvidenceFact
          label="Inventory before"
          value={evidence.cash.beforeSnapshotId ?? "not captured"}
        />
        <EvidenceFact
          label="Inventory after"
          value={evidence.cash.afterSnapshotId ?? "not captured"}
        />
      </dl>
    </section>
  );
};

const EvidenceFact = ({ label, value }: { readonly label: string; readonly value: string }) => (
  <div>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);
