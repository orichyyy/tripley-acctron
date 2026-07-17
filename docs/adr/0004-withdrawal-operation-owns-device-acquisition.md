# The withdrawal operation owns device acquisition

Accepting `withdrawal.start` creates the operation before card or QR acquisition begins. The operation's Flow owns acquisition, device sessions, locks, timeout, interruption, scoped state, and cleanup, while the UI only invokes commands and renders projected state; this makes all side effects attributable and testable, prevents page rerenders from orphaning XFS work, and lets a project-owned card node demonstrate extension without modifying core. The trade-off is that waiting for the first credential counts as an active operation.
