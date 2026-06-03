# @tripley-acctron/flow-engine

Flow compiler, engine, step registry, raw steps, timeout service, and step lifecycle scope.

Update this document when flow graph schema, step results, or scope behavior changes.

## Timeout

`DefaultTimeoutService` supports expiring timeouts, reset, cancel, abort-signal cancellation, and
More Time dialogs through `UiPort`.
