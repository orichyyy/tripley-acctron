# ADR 0037: Investigation storage preserves facts and generated artifacts

Cash inventory snapshots, cash-unit observations, operation evidence, and transaction cash summaries are canonical immutable facts. They are stored independently from bank-specific EJ text, receipt layout, or management-system message formats. Project extensions add namespaced, schema-versioned fact fields rather than changing core device or transaction records, and unrestricted native XFS payloads are not retained.

Every EJ entry, management report, receipt payload, or equivalent projection that is actually generated or delivered is preserved as an immutable `InvestigationArtifact`. The artifact records its kind, projector identity and version, schema version, content type, content hash, generation time, safe content reference, and delivery outcome. Security redaction is enforced before project projection and cannot be bypassed by a formatter.

Canonical facts may be projected again after a protocol or formatter upgrade, but reprojection creates a new versioned artifact and never overwrites the historical artifact. This preserves both the ability to integrate with new bank systems and the ability to prove what the application generated or sent at the time of the original transaction.
