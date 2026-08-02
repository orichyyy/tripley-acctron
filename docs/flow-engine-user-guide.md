# Flow Engine User Guide

This guide explains how to design, run, integrate, extend, and test workflows with
`@tripley-kit/web-container-flow-engine`. It is written first for application developers and
then for framework and plugin maintainers.

The guide describes both the executable runtime in this repository and the intended design.
Every capability that is not executable today is marked **Planned**.

## 1. Capability status

Status labels used throughout this guide:

- **Available now** — implemented by `ExecutableFlowEngine` and covered by the current code.
- **Partial** — represented in public types or implemented with narrower semantics than the
  target design.
- **Planned** — design intent only; do not rely on it in production code.

| Capability | Status | Current behavior |
| --- | --- | --- |
| Explicit flow registration and start | Available now | Definitions are registered by ID and version, then started explicitly. |
| `action`, `decision`, `terminal` nodes | Available now | Built-in executors are registered automatically. |
| `userInput` node | Available now | Supports multiple adapters, device locks, validation, feedback, timeouts, idle timeouts, and safe summaries. |
| `waitEvent` node | Partial | Pauses the instance; application code must call `resume()`. It does not subscribe to an event bus itself. |
| Synchronous and asynchronous `subflow` | Available now | Child definition must already be registered at the exact version. |
| Custom node executors and effect runners | Available now | Register them through the engine registries. |
| Hooks, projection, catch/finally | Available now | Global hooks run before definition hooks. |
| Flow and node timeout | Available now | Timeouts cancel or fail the in-memory execution. |
| Explicit retry result | Available now | Flow-level retry policy controls total attempts and fixed backoff. |
| Pause, resume, cancel, external abort | Available now | Pause takes effect at a node boundary; wait/pause results suspend immediately. |
| Interrupt promise and policy routing | Available now | One supplied interrupt promise is consumed at most once. |
| Input/output validation | Available now | Validator objects run at flow start and flow completion. |
| In-memory completed-instance retention | Available now | Defaults to the latest 100 snapshots. |
| `parallel` and `race` node executors | Planned | Kinds exist in the type vocabulary, but no built-in executors exist. |
| Compensation execution | Planned | Policy and node kind are typed but not executed. |
| Durable `FlowStore` and restart recovery | Planned | Recovery types exist; the engine stores instances only in memory. |
| JSON schema import/export | Planned | The current primary format is the TypeScript DSL. |
| Concurrency enforcement | Planned | `FlowConcurrencyPolicy` is typed but not enforced by the engine. |
| Automatic Event Bus start or wait subscription | Planned | Start and resume are explicit application responsibilities. |

## 2. Design and mental model

A flow definition is immutable configuration. A flow instance is one in-memory execution of a
registered definition version. The engine owns execution and publishes safe state outward; UI
components render that state and submit intent, but do not own workflow transitions.

```text
Application command / runtime
          |
          | register + start
          v
  ExecutableFlowEngine
          |
          +--> FlowInstanceRuntime ----> snapshot / completion
          |          |
          |          +--> FlowNodeRuntime
          |                    |
          |                    +--> node executor
          |                    +--> effect runner(s)
          |                    +--> hooks / timeout / interrupt
          |
          +--> projection port -------> UiPort / diagnostics
          +--> input adapters --------> UI command / PIN pad / QR / device
          +--> ScopedStore -----------> per-flow intermediate values
```

The important boundaries are:

- `ExecutableFlowEngine` owns definitions, instances, registries, and completed snapshots.
- `FlowInstanceRuntime` owns status, current node, path, trace, retry count, cancellation, and
  suspension.
- `FlowNodeRuntime` selects an executor and applies hooks, node timeout, interrupts, and effects.
- Node executors implement one node kind. Built-ins are intentionally small.
- `FlowProjectionPort` is an outbound read model; it must not contain sensitive outputs.
- `InputSourceRegistry`, `DeviceRegistry`, and `DeviceLockManager` keep device work at the edge.
- `ScopedStore` is the current channel for intermediate node outputs.

Flows are graph-shaped, but the current runtime is sequential. Normal transitions use `next` or
an explicit `{ type: "next", nodeId }`. A decision returns a branch name, and `edges` maps that
branch to a target. `edges` are not used to infer ordinary `next` transitions.

## 3. Install and import

Inside this pnpm workspace, add the package to the consuming workspace package:

```json
{
  "dependencies": {
    "@tripley-kit/web-container-flow-engine": "workspace:*"
  }
}
```

Import public APIs only from the package root:

```ts
import {
  createFlowEngine,
  defineFlow,
  defineNode,
} from "@tripley-kit/web-container-flow-engine";
```

Do not import `instance-runtime.ts` or other internal source files directly.

## 4. Minimal executable flow

```ts
import {
  createFlowEngine,
  defineFlow,
  defineNode,
} from "@tripley-kit/web-container-flow-engine";

const greeting = defineFlow<{ name: string }, { message: string }>({
  id: "example.greeting",
  version: "1.0.0",
  startNodeId: "finish",
  nodes: {
    finish: defineNode({
      id: "finish",
      kind: "terminal",
      output: (ctx) => ({
        message: `Hello, ${(ctx.input as { name: string }).name}`,
      }),
    }),
  },
});

const engine = createFlowEngine();
engine.register(greeting);

const instance = await engine.start("example.greeting", { name: "Ada" });
const snapshot = await instance.completion;

if (snapshot.status !== "completed") {
  throw new Error(`Greeting failed: ${snapshot.status}`);
}
console.log(snapshot.output?.message);
```

`start()` returns after the runtime has been created, not after the flow completes. Await
`instance.completion` for the terminal snapshot. Use `instance.snapshot()` for a synchronous,
point-in-time view.

## 5. Defining a flow

The most frequently used fields are:

```ts
const definition = defineFlow<Input, Output>({
  id: "domain.operation",
  version: "1.0.0",
  description: "A stable operational description",
  inputSchema,
  outputSchema,
  startNodeId: "prepare",
  nodes: { /* node ID -> definition */ },
  edges: [ /* decision branch mappings */ ],
  timeoutMs: 60_000,
  retry: { maxAttempts: 2, backoffMs: 250 },
  policies: { /* input timeout and interrupts */ },
  hooks: [],
  catch: (_ctx, error) => ({ type: "fail", error }),
  finally: async (ctx) => {
    await ctx.scopedStore.clearScope("flow", ctx.instanceId, "flow.finished");
  },
});
```

`defineFlow()` currently validates that `startNodeId` exists and that node IDs are non-empty. It
does not validate every target, branch, unreachable node, cycle, or executor at definition time.
Those errors can appear only when execution reaches the invalid configuration.

### Version registration

Multiple versions of the same flow ID may be registered. Starting without `options.version`
selects the most recently registered version, not the highest semantic version. Bind an exact
version for subflows and long-lived integrations:

```ts
engine.register(flowV1);
engine.register(flowV2);

await engine.start(flowV1.id, input, { version: "1.0.0" });
engine.unregister(flowV1.id, "1.0.0");
```

Duplicate `id@version` registration throws `flow.definition.duplicate`.

### Input and output validators

A validator is any object with `validate(value)` and may be synchronous or asynchronous. The
validated input becomes `ctx.input`; output validation runs only for an `end` result.

```ts
const amountValidator = {
  validate(value: unknown): { amount: number } {
    if (!value || typeof value !== "object" || !("amount" in value)) {
      throw new Error("amount is required");
    }
    const amount = Number(value.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("amount must be positive");
    }
    return { amount };
  },
};
```

Prefer a schema adapter that returns a narrowed, normalized value. Never treat TypeScript generic
parameters alone as runtime validation.

## 6. Built-in nodes and transitions

### Action

An action runs application logic. If `run()` returns a `FlowNodeResult`, the runtime uses it
directly. Any other return value becomes the node output and moves to `node.next`, or ends the flow
when no `next` exists.

```ts
const reserve = defineNode({
  id: "reserve",
  kind: "action",
  next: "confirm",
  timeoutMs: 5_000,
  run: async (ctx) => {
    const result = await reservations.reserve(ctx.input, ctx.signal);
    return { reservationId: result.id };
  },
});
```

The runtime stores an output under `node.<nodeId>.output` and `lastOutput` in the instance's flow
scope. Keep stored values small and non-sensitive.

### Decision

A decision returns a branch string. Configure each reachable branch in `edges`:

```ts
const route = defineNode({
  id: "route",
  kind: "decision",
  decide: (ctx) =>
    ctx.scopedStore.scope("flow", ctx.instanceId)
      .getOrThrow<{ approved: boolean }>("lastOutput").approved
      ? "approved"
      : "rejected",
});

const edges = [
  { from: "route", branch: "approved", to: "success" },
  { from: "route", branch: "rejected", to: "failure" },
];
```

A missing mapping fails with `flow.branch.missing`.

### Terminal

A terminal ends successfully. A literal or function may supply its output. With no explicit
output, it uses the most recent stored node output.

### Wait event

**Partial.** A `waitEvent` node publishes a paused snapshot and waits for an explicit resume:

```ts
const wait = defineNode({
  id: "waitForConfirmation",
  kind: "waitEvent",
  waitFor: { topic: "customer.confirmed", timeoutMs: 30_000 },
  next: "finish",
});

const instance = await engine.start(flow.id, input);
// An application event bridge decides that this event belongs to this instance.
await engine.resume(instance.instanceId, { confirmed: true });
```

The `topic` and the wait condition's `timeoutMs` are descriptive today. The engine does not
subscribe or time out this suspended state. Put the timeout in the bridge, cancel the instance on
expiry, and store resume data at `resumeInput` only if a later node needs it.

### Subflow

Register the child before the parent. A synchronous subflow awaits the child and propagates its
output, failure, or cancellation. An asynchronous subflow continues with `{ instanceId }`.

```ts
const childNode = defineNode({
  id: "authenticate",
  kind: "subflow",
  next: "continue",
  subflow: {
    flowId: "customer.authentication",
    version: "2.0.0",
    mode: "sync",
    input: (ctx) => ({ customerId: (ctx.input as { customerId: string }).customerId }),
    outputKey: "authentication.result",
  },
});
```

Child start currently inherits only the parent abort signal and trace ID. It does not automatically
inherit parent policy overrides, projection overrides, devices, locks, logger, or custom instance
scope. Engine-level dependencies still apply.

### Effect-first results

Return `{ type: "effects", effects }` to execute registered effect runners in order. A runner may
return a new result to redirect execution. If no runner redirects, the node follows `next` or ends.

Use effects for reusable, observable side effects. Do not use them to hide a large business
workflow inside one runner.

## 7. Node results and lifecycle

| Result | Runtime behavior |
| --- | --- |
| `next` | Move to the specified node. |
| `branch` | Resolve a branch edge from the current node. |
| `end` | Validate output and complete. |
| `fail` | Finish with `failed`. |
| `cancel` | Finish with `cancelled`. |
| `pause` | Suspend, then rerun the same node after resume. |
| `wait` | Suspend, then move to `node.next` after resume; without `next`, rerun the node. |
| `retry` | Rerun the same node within the flow retry budget. |
| `effects` | Run effects sequentially, then use a returned result or `next`. |
| `stay` / `reenter` | Rerun the target node; the test runner stops on these results. |

The instance statuses are `running`, `paused`, `completed`, `failed`, and `cancelled`. Every node
visit is appended to `snapshot.path`, including retries and re-entry.

## 8. Errors, timeout, retry, cancellation, and interrupts

### Errors and `catch`

Executor errors, node timeouts, missing executors, and hook errors inside node execution reach the
flow `catch` handler. Return a normal result to recover, or a `fail` result to preserve explicit
failure semantics. Do not catch cancellation by converting it to success.

`finally` runs after the main loop for completion, failure, and cancellation. Use it for bounded,
idempotent cleanup. Cleanup should tolerate partially initialized resources.

### Timeouts

- `FlowDefinition.timeoutMs` requests flow cancellation with `FLOW.TIMEOUT`.
- `FlowNodeDefinition.timeoutMs` aborts the node signal and raises `FlowNodeTimeoutError`.
- `UserInputNodeInput.timeoutMs` overrides the default user-input timeout.
- `idleTimeoutMs` resets from input progress and applies separately to user input.

Code performing I/O must observe `ctx.signal`; aborting a signal cannot forcibly stop a promise
that ignores it.

### Retry

Retries are opt-in from node code:

```ts
return transientFailure
  ? { type: "retry", reasonCode: "HOST.TEMPORARY" }
  : { type: "next", nodeId: "done", output };
```

`maxAttempts` is the total attempt budget, so `2` permits one retry. Backoff is fixed. The runtime
does not infer transient errors and does not add idempotency keys. Generate a stable operation key
outside the retrying call and make the downstream operation idempotent.

### Cancellation and pause

```ts
await engine.cancel(instanceId, {
  source: "user",
  reasonCode: "CUSTOMER.CANCELLED",
});

await engine.pause(instanceId, "OPERATOR.PAUSED");
await engine.resume(instanceId, resumeData);
```

An API pause request is observed between nodes. A node result of `pause` suspends immediately after
that node. `resumeData` is stored in the flow scope at `resumeInput`.

### Interrupts

Supply a correlated promise at start and define policy routing by interrupt ID:

```ts
const instance = await engine.start(flow.id, input, {
  interrupt: cardRemovedPromise,
  policies: {
    interrupts: [{
      id: "card.removed",
      priority: 100,
      action: { type: "cancelFlow", reasonCode: "CARD.REMOVED" },
    }],
  },
});
```

The first interrupt is consumed once. `eventTopic` is metadata only; an external bridge must create
the promise. `appliesTo` currently matches a node ID or node kind, not an arbitrary condition ID.

## 9. User input in detail

A `userInput` node coordinates input adapters and device locks. It performs these steps:

1. Resolve the dynamic profile, UI state, validation, and sources.
2. Evaluate each source's `enabledWhen` through `evaluateCondition`.
3. Acquire one lease for all declared `deviceId` values.
4. Validate and start eligible source adapters.
5. Race source results, timeout, idle timeout, interrupt, and abort.
6. Emit safe trace/log summaries and validation feedback.
7. Cancel unfinished sessions and release the lease in `finally`.

Register every source kind before starting the flow:

```ts
const inputSources = new InputSourceRegistry();
inputSources.register(uiCommandAdapter);
inputSources.register(pinPadAdapter);

const engine = createFlowEngine({ inputSources });
```

Use local validation for syntax, length, checksum, parsing, and range checks. Prefer a separate
action node for host, business, or device validation. The `business` validation callback is
available, but separating remote work makes retry, telemetry, and paths easier to understand.

Secure input guidance:

- Set both node `security: "secure"` and adapter/source `secure: true` where applicable.
- Return opaque encrypted material or a token, never clear PIN data.
- Provide adapter `safeSummary`; never place secret material in feedback or application logs.
- Keep `trace.safeToLog: false` and `summaryOnly: true` on secure nodes.
- Treat flow-scope node outputs as sensitive unless the adapter result is already safe.

Some input configuration fields are currently advisory or only partly enforced. In particular,
`acceptance.firstValidWins`, validation `failure.mode/maxAttempts`, and
`cleanup.cancelDevicesOnExit` do not provide additional runtime enforcement beyond the executor's
current race/re-entry/cleanup behavior. Enforce attempt budgets at the application operation layer,
as `apps/kiosk-example` does.

## 10. Production integration

### Engine composition

Create one engine for the application runtime and inject shared infrastructure:

```ts
const engine = createFlowEngine({
  devices,
  deviceLocks,
  inputSources,
  scopedStore,
  logger,
  projection: new UiPortFlowProjectionAdapter(ui),
  defaultPolicies,
  hooks: observabilityHooks,
  completedInstanceRetention: { maxCount: 100 },
  instanceIdFactory: () => crypto.randomUUID(),
});
```

Call `await engine.dispose()` during application shutdown. It cancels active instances and clears
in-memory history. Do not create an engine per React render.

Start options may override devices, locks, store, logger, policies, and projection for one instance.
Policy precedence is registered `flow.defaults`, engine defaults, definition policies, then start
options.

### UI and React boundary

`UiPortFlowProjectionAdapter` publishes a deliberately small projection under `flow.instance` in a
scope keyed by `flowInstanceId`. It excludes raw node and terminal outputs.

Recommended ownership:

- The application/runtime layer creates and disposes the engine.
- A command handler starts or cancels a flow.
- React renders projection state and dispatches commands/input submissions.
- React unmounting does not implicitly cancel business work.
- The runtime correlates UI submissions to an active interaction identity.

The concrete example is `apps/kiosk-example/src/runtime/create-runtime.ts`: it creates shared
registries, locks, store and UI, registers correlated input adapters, creates the projection, and
disposes the flow engine after the kiosk runtime.

`apps/kiosk-example/src/runtime/input-runner.ts` demonstrates the operation boundary. It creates a
short-lived, correlated one-node input flow; supplies devices, locks, abort signal and feedback;
awaits completion; and unregisters the unique definition in `finally`.

### Event Bus bridge

Because event subscription is not built in, keep correlation and subscription outside the engine:

```ts
const instance = await engine.start(waitingFlow.id, input);
const unsubscribe = eventBus.subscribe("customer.confirmed", async (event) => {
  if (event.operationId !== operationId) return;
  unsubscribe();
  await engine.resume(instance.instanceId, event);
});
```

Production code must also unsubscribe on completion/cancellation and implement a deadline. Avoid a
global event that can resume the wrong instance.

### Business services

`FlowExecutionContext` intentionally has no generic `services` property. Use one of these patterns:

- Close over a narrow service interface in a flow factory.
- Register a custom node executor constructed with the service.
- Put opaque operation identifiers—not service objects—in `ScopedStore`.

Prefer a flow factory for application-specific logic and a custom executor for reusable plugin
capabilities.

### Scoped Store

Use `scope("flow", ctx.instanceId)` for per-instance intermediates. Use transaction scope only when
the transaction lifecycle deliberately outlives a flow. Clear flow scope in `finally`, and never
depend on in-memory store state for crash recovery.

### Logging, hooks, and projection

Hooks are appropriate for trace correlation, metrics, audit boundaries, and test interception.
Keep hooks fast and failure-aware because they run inside execution. Projection is for current safe
state; trace is for bounded diagnostic events; durable audit belongs in a separate service.

## 11. Extension integration

### Custom node executor

```ts
import type {
  FlowExecutionContext,
  FlowNodeDefinition,
  FlowNodeExecutor,
  FlowNodeResult,
} from "@tripley-kit/web-container-flow-engine";

interface HostRequestNode extends FlowNodeDefinition<"bank.hostRequest"> {
  readonly operation: string;
}

class HostRequestExecutor implements FlowNodeExecutor<HostRequestNode> {
  readonly kind = "bank.hostRequest";

  constructor(private readonly host: HostPort) {}

  async execute(
    ctx: FlowExecutionContext,
    node: HostRequestNode,
  ): Promise<FlowNodeResult> {
    const output = await this.host.request(node.operation, ctx.input, ctx.signal);
    return node.next
      ? { type: "next", nodeId: node.next, output }
      : { type: "end", output };
  }
}

engine.nodeExecutors.registerExecutor(new HostRequestExecutor(host));
```

Use a namespaced kind. The executor should contain capability integration, while the definition
contains declarative operation data.

### Effect runner

Register an `EffectRunner` for a namespaced effect kind, then return an effects result from a node.
Runners execute sequentially. Define whether each effect is idempotent and what a repeated call
means before enabling retries around it.

### Policy registry

Register a policy with kind `flow.defaults` to contribute base `FlowPolicies`. Only the built-in
policy fields interpreted by the runtime have behavior. Arbitrary policy keys are available to
custom executors through `ctx.policies`.

## 12. Worked withdrawal example

The complete definition is in `examples/flow.definition.example.ts`.

Its path is:

```text
enterAmount -> enterPin -> authorize -> routeAuthorization
                                      -> approved
                                      -> rejected

enterAmount / enterPin timeout ------> timedOut
card.removed interrupt --------------> cancelled
```

Key points:

- `enterAmount` races a physical PIN-pad data source with a correlated UI command source.
- Local validation normalizes the winning result to a number.
- `enterPin` marks both node and source as secure and requests cleanup on exit.
- `authorize` reads the amount from `node.enterAmount.output`. The deterministic body shows where
  an injected host port belongs.
- `routeAuthorization` returns a branch, and `edges` contain both possible mappings.
- Terminal nodes build a typed, safe business output.
- `finally` clears the instance's flow scope.

To execute it, compose the engine with adapters for `pinpad.data`, `ui.command`, and `pinpad.pin`,
register the definition, then start it with `{ accountId, approve }`. The example intentionally
does not fabricate production device adapters.

## 13. Testing

`FlowTestRunner` uses the same engine and built-in executors. Register fake input adapters, custom
executors, and effect runners in its constructor:

```ts
const runner = new FlowTestRunner({ inputSources, nodeExecutors, effectRunners });
const snapshot = await runner.run(flow, input, {
  scopedStore,
  evaluateCondition: (id) => id === "feature.qr.enabled",
  traceId: "test-trace",
});

expect(snapshot.status).toBe("completed");
expect(snapshot.path).toEqual(["prepare", "route", "success"]);
```

Test at least:

- Every decision branch and terminal status.
- Invalid input, timeout, idle timeout, abort, and interrupt cleanup.
- Node timeout and catch behavior.
- Retry exhaustion and stable idempotency key reuse.
- Secure trace/log redaction.
- Synchronous child failure/cancellation propagation.
- Projection contains no raw sensitive output.

`expectFlow()` currently returns a `FlowTestRunner`; it is not the fluent assertion API shown in
older design material. Use `runner.run()` and normal Vitest assertions.

## 14. Recommended practices

1. Keep each node focused on one observable business step.
2. Model remote validation as a separate action node from local input validation.
3. Use explicit terminal nodes for meaningful business outcomes.
4. Give flows and custom kinds stable, namespaced IDs; pin exact subflow versions.
5. Validate at system boundaries and return normalized data.
6. Put side effects at the edges and make retryable side effects idempotent.
7. Pass and observe `ctx.signal` for all cancellable I/O.
8. Correlate UI input, events, interrupts, and instance IDs to one operation.
9. Project only safe state; never expose raw snapshots directly to UI.
10. Keep secrets out of outputs, feedback, trace, logger metadata, and long-lived stores.
11. Use `finally` for idempotent cleanup and always release external subscriptions.
12. Await `completion` and inspect `status`; do not assume a started flow completed successfully.
13. Bound in-memory history and export durable audit separately.
14. Test definitions with the production runtime semantics through `FlowTestRunner`.

Avoid these anti-patterns:

- One giant action node containing the entire transaction.
- React effects that start duplicate flows or cancel on component unmount.
- Selecting the implicit latest version for a compatibility-sensitive child flow.
- Using `waitEvent` as if it subscribed to the Event Bus.
- Relying on typed but unimplemented `parallel`, `race`, recovery, or compensation behavior.
- Retrying host or physical-device effects without an idempotency design.
- Storing clear PINs, card data, tokens, or full host messages in flow scope or trace.

## 15. Current limitations and planned direction

The following public types express target architecture but need runtime implementation before use:

- Built-in executors and scheduling semantics for `parallel` and `race`.
- Compensation registration, ordering, and failure semantics.
- Durable instance storage, checkpoints, restart loading, and recovery modes.
- Concurrency keys/reject/queue policy enforcement.
- Event Bus integration for correlated waits and deadlines.
- Static graph validation beyond start-node existence.
- A fluent `expectFlow()` assertion DSL.
- Full enforcement of user-input attempt and cleanup configuration.
- Runtime application of definition-level trace policy.

When implementing these capabilities, preserve backward-compatible status and snapshot semantics or
publish a new flow version. Do not emulate them in application code under the same names without a
clear compatibility boundary.

## Appendix A. Public API index

### Definition DSL

- `defineFlow(definition)` — validates the minimum definition shape and returns it.
- `defineNode(node)` — typed identity helper for any node.
- `defineUserInputNode(node)` — typed identity helper for user input.
- `bindFlowVersion(definition)` — returns `{ flowId, version }`.

### Engine

- `createFlowEngine(options)` — creates `ExecutableFlowEngine` and registers built-ins.
- `ExecutableFlowEngine` — production in-memory implementation and registry owner.
- `FlowEngine` — interface for register, start, lifecycle control, query, and disposal.
- `FlowInstance` — instance identity, `snapshot()`, and `completion` promise.
- `FlowStartOptions` — exact version/ID, trace, cancellation, dependency, policy, and projection
  overrides.
- `FlowEngineOptions` — registries, shared dependencies, hooks, projection, retention, and ID factory.
- `FlowCancellationReason`, `FlowInstanceFilter`, `FlowProjectionPort` — lifecycle support contracts.

### Definitions and runtime contracts

- `FlowDefinition`, `FlowNodeDefinition`, `AnyFlowNodeDefinition`, `FlowEdge`.
- `ActionFlowNodeDefinition`, `DecisionFlowNodeDefinition`, `WaitEventFlowNodeDefinition`,
  `TerminalFlowNodeDefinition`, `SubflowNodeDefinition`, `UserInputNodeDefinition`.
- `FlowNodeResult`, `FlowInstanceSnapshot`, `FlowExecutionContext`, `FlowValidator`.
- `FlowRetryPolicy`, `FlowPolicies`, `FlowInterruptPolicy`, `FlowRecoveryPolicy`,
  `FlowCompensationPolicy`, `TraceSummaryPolicy`.
- `FlowHook`, `FlowHookName`, `FlowHookEvent`, `FlowErrorHandler`, `FlowFinallyHandler`.

### Extensibility

- `FlowNodeExecutorRegistry`, `EffectRunnerRegistry`, `FlowPolicyRegistry`.
- `FlowNodeExecutor`, `EffectRunner`, `FlowPolicy`.
- Built-in executor classes: `ActionNodeExecutor`, `DecisionNodeExecutor`,
  `WaitEventNodeExecutor`, `TerminalNodeExecutor`, `SubflowNodeExecutor`,
  `UserInputNodeExecutor`.
- `FlowNodeRuntime`, `FlowNodeTimeoutError` are exported indirectly only if added to the package
  root; they are currently internal implementation details and should not be imported directly.

### User input

- `InputProfile`, `InputConstraints`, `InputProfileResolver`.
- `UserInputSourceDefinition`, `UserInputValidationDefinition`,
  `UserInputValidationResult`, `UserInputNodeInput`.
- `UiRouteState`, `UiRouteResolver`, `UiFeedbackState`.
- `summarizeUserInputResult()` — creates a safe summary when used correctly with the secure flag.

### Projection and testing

- `UiPortFlowProjectionAdapter`, `CompositeFlowProjection`, `toFlowUiProjection()`.
- `FlowUiProjection`, `UiPortFlowProjectionOptions`.
- `FlowTestRunner`, `FlowTestRunnerRegistries`, `FlowTestRunnerOptions`, `expectFlow()`.

## Appendix B. Q&A

### Why did `start()` return before my workflow finished?

It returns a `FlowInstance`. Await `instance.completion` and inspect the final status.

### Why does my decision fail even though the destination node exists?

Decision routing uses an edge matching both `from` and `branch`. A node's existence alone is not
enough.

### Why did `waitEvent` never resume when the event was published?

The current executor does not subscribe to Event Bus. Add a correlated application bridge and call
`engine.resume(instanceId, event)`.

### Why was the wrong flow version started?

Starting without a version selects the most recently registered version. Supply an exact version,
especially for subflows.

### Why did cancellation not stop my network or device call immediately?

The runtime aborts `ctx.signal`; the called API must observe that signal. Wrap or replace APIs that
cannot be cancelled, and still protect late results with operation fencing.

### Where should intermediate results be stored?

Node outputs are automatically available at `node.<nodeId>.output` and `lastOutput` in the flow
scope. Store only bounded, safe values and clear the scope in `finally`.

### How do I inject a host or business service?

Create the flow through a factory that closes over a narrow port, or create a custom executor with
that port in its constructor. `FlowExecutionContext` has no generic service locator.

### Can I run two nodes in parallel?

Not with built-in runtime support today. The `parallel` and `race` kind names are planned. Do not
hide unbounded concurrency inside an action node; use an explicit, well-tested custom executor only
when necessary.

### Does the engine recover active flows after a process restart?

No. Current instances and retained snapshots are in memory. Recovery types are design intent only.

### Is `snapshot.trace` safe to send to the UI or central logs?

No blanket guarantee exists. User input creates safe summaries when configured correctly, but
custom nodes and hooks can record arbitrary metadata. Review and redact at every boundary. Use the
safe UI projection for rendering.

### Why does my test stop on invalid input instead of looping?

`FlowTestRunner` supplies a test-only stop policy for `stay` and `reenter`, allowing the test to
assert feedback without an endless input loop.

### When should a flow be a subflow instead of another node?

Use a subflow when the unit has its own versioned contract, meaningful input/output, independent
tests, and reuse across parent workflows. Use a node for one step that belongs to the parent's
lifecycle.
