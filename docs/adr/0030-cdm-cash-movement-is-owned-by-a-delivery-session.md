# CDM cash movement is owned by a delivery session

Starting CDM dispense creates one exclusive, operation-bound Cash Delivery Session that remains responsible through present, wait-for-taken, retract, cancellation, and reconciliation. A timeout or cancellation never proves that cash did not move, presented cash is not terminal, and the logical service cannot start another delivery until the session reaches taken, retracted, not-dispensed, or custody-unknown intervention; financial posting and reversal remain outside Device Service.
