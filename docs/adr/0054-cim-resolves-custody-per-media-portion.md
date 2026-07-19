# CIM resolves custody per media portion

A Cash Acceptance Session resolves custody per Deposit Media Portion and closes only when every known or potential portion is terminal, superseding ADR-0051's session-wide outcome. This represents mixed results such as accepted escrow committed to inventory while refused notes are returned, retained, or unknown, without allowing one successful disposition to hide another unresolved subset; a session with no portion resolves separately as `noMediaAccepted`.
