# CIM abort requests do not assert cash return

Customer cancellation, interaction timeout, operation deadline, route exit, and runtime shutdown append an Abort Request and prohibit new acceptance or commit actions, but they do not assert that an in-flight native command was cancelled or that media was returned. A possibly dispatched command is reconciled at most once, and foreground Flow exits only after a no-media terminal result or durable Recovery Supervisor transfer; the immediate abort disposition reports ownership transfer rather than physical success.
