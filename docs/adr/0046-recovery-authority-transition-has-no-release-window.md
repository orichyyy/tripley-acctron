# Recovery authority transition has no release window

A healthy Kiosk Runtime transfers a non-terminal cash session from transaction ownership to recovery ownership through an owner-authorized host transition that preserves operation, session, and logical-service identity while atomically advancing the fencing token and changing authority. Releasing and reacquiring the host lease would create an unsafe command window, while a database-only transfer would leave the old native authority valid; cross-runtime takeover remains a separate expiry-and-higher-token operation.
