# CIM recovery never initiates undispatched physical commit

Recovery authority may observe, return confirmed escrow, retract returned media under policy, and reconcile a CIM Physical Commit that may already have reached the device, but it never initiates a new physical commit. A crash after customer or host approval but before physical-commit dispatch therefore returns escrow; confirmed prior physical commit is preserved as physical fact for project posting recovery, and uncertain physical commit enters reconciliation rather than duplicate physical commit or rollback.
