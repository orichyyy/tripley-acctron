# CIM accepts multiple batches but resolves all escrow

A Cash Acceptance Session may accumulate multiple immutable Cash Acceptance Batches under an operation-frozen limit policy, with every completed batch advancing the escrow snapshot revision. The foundation exposes only whole-session `physicallyCommitAllEscrow` or `rollbackAllEscrow`, matching the native CIM contract; when observed acceptance exceeds project limits the complete escrow is returned rather than truncated, and selective physical commit requires a future explicit device capability instead of simulated partial success.
