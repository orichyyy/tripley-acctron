# All operations use durable finalization plans

Every operation runs a frozen, durable Operation Finalization Plan on success, failure, cancellation, timeout, or recovery transfer; local evidence, custody handoff, scoped cleanup, and safe resource closure never depend on whether a host protocol accepts a completion message. Framework, device, and project responsibilities are registered idempotent finalizers, while Host Financial Completion Message, advice, and reversal remain optional protocol contributions rather than aliases for application cleanup.
