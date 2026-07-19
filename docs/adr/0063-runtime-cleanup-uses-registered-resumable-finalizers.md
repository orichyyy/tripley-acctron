# Runtime cleanup uses registered resumable finalizers

Kiosk Runtime replaces coordinator- and flow-specific `finally` cleanup with registered, versioned finalizers whose frozen dependency plan and durable step state can resume after process loss. Criticality separates custody and record-closure barriers from detached durable delivery and local UI cleanup, allowing CIM and future modules to contribute focused finalizers without creating transaction-type branches or treating optional host messages as application closure.
