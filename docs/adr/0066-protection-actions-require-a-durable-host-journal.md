# Protection actions require a durable host journal

Production Host Disconnect Protection uses a hostd-owned SQLite Protection Journal Store rather than the unavailable application's business database. Protection activation and each unique side-effect intent are durable before dispatch, restart never repeats an incomplete action, unresolved records cannot be automatically deleted, and journal failure keeps resource-group fencing while allowing observation but forces intervention instead of an unrecorded retract, retain, return, or rollback.
