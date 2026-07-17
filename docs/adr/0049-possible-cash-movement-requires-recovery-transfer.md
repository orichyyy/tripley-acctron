# Possible cash movement requires recovery transfer

When foreground business activity stops, it may close a cash session directly only when durable evidence proves `notDispensed`; staged, presented, awaiting-take, retracting, execution-unknown, and otherwise uncertain dispense states must transfer durable ownership to the Recovery Supervisor before Flow exits. This lets Flow wait only for safe ownership transfer rather than physical completion while preventing cancellation, timeout, route exit, or shutdown from orphaning cash whose movement is possible.
