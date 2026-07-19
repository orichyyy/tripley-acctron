# CIM establishes durable custody before opening entry

The runtime acquires the device lock and host-backed transaction lease, persists a complete before-inventory snapshot, and creates the Cash Acceptance Session and Cash Recovery Lease before dispatching `cashInStart`. Because opening the input position can expose the kiosk to customer media before an application response is observed, a possibly dispatched start is at-most-once and enters custody reconciliation rather than being retried or treated as initialization failure.
