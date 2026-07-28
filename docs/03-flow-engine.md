# 03. Flow Engine

## Purpose

Flow Engine is the workflow runtime for business orchestration. It coordinates UI navigation, UI state, native/window/device calls, command results, event waits, timeout, retry, cancellation, recovery, and cleanup.

## Core decisions

- TypeScript DSL primary; JSON schema import/export supported.
- Flow is a DAG; individual nodes may implement internal state machines.
- Flow v1 starts only through `flowEngine.start(flowId, input)`.
- Nodes support direct `ctx` calls and effect-first returns; effect-first is recommended.
- Flow supports pause/resume, wait event, flow/node timeout, node/flow retry, catch/finally, compensation interface, and optional persistence.
- Node types are standardized but extensible.
- Flow trace stores summaries by default, not complete sensitive payloads.

## Standard node kinds

Built-in node kinds:

```text
action
userInput
waitEvent
decision
parallel
race
subflow
compensation
terminal
```

Node kind is open-ended. Project plugins can register new executors:

```ts
ctx.flowNodeExecutors.register('bank.hostRequest', new HostRequestNodeExecutor());
ctx.flowNodeExecutors.register('device.cashDispense', new CashDispenseNodeExecutor());
```

## Flow definition

```ts
export interface FlowDefinition<Input = unknown, Output = unknown> {
  id: string;
  version: string;
  description?: string;
  inputSchema?: FlowValidator<Input>;
  outputSchema?: FlowValidator<Output>;
  startNodeId: string;
  nodes: Record<string, FlowNodeDefinition>;
  edges: FlowEdge[];
  concurrency?: FlowConcurrencyPolicy;
  timeoutMs?: number;
  retry?: FlowRetryPolicy;
  policies?: FlowPolicies;
  hooks?: FlowHook[];
  catch?: FlowErrorHandler;
  finally?: FlowFinallyHandler;
  compensation?: FlowCompensationPolicy;
}
```

## Node result

```ts
type FlowNodeResult =
  | { type: 'next'; nodeId: string; output?: unknown }
  | { type: 'branch'; branch: string; output?: unknown }
  | { type: 'wait'; waitFor: FlowWaitCondition }
  | { type: 'end'; output?: unknown }
  | { type: 'fail'; error: unknown }
  | { type: 'cancel'; source?: CancellationSource; reasonCode: string; metadata?: unknown }
  | { type: 'pause'; reasonCode: string; metadata?: unknown }
  | { type: 'retry'; reasonCode: string }
  | { type: 'effects'; effects: Effect[] };
```

## Flow Engine API

```ts
export interface FlowEngine {
  register<Input, Output>(definition: FlowDefinition<Input, Output>): void;
  unregister(flowId: string): void;
  start<Input = unknown, Output = unknown>(
    flowId: string,
    input: Input,
    options?: FlowStartOptions
  ): Promise<FlowInstance<Output>>;
  pause(instanceId: string, reason?: string): Promise<void>;
  resume(instanceId: string, input?: unknown): Promise<void>;
  cancel(instanceId: string, reason?: FlowCancellationReason): Promise<void>;
  getInstance(instanceId: string): Promise<FlowInstanceSnapshot | null>;
  listInstances(filter?: FlowInstanceFilter): Promise<FlowInstanceSnapshot[]>;
  dispose(): Promise<void>;
}
```

## Explicit start only

No v1 API auto-starts a flow from Event Bus, UI action, or plugin lifecycle. UI command or plugin code must explicitly call:

```ts
await flowEngine.start('kiosk.withdrawal', input);
```

Once running, a flow may wait for events or command results.

## User input model

User input nodes are first-class and are executed by `UserInputNodeExecutor` and `InputOrchestrator`. They declare `sources` such as `pinpad.data`, `pinpad.pin`, `barcodeReader.qr`, `ui.command`, or project-defined kinds.

Dynamic input profiles are supported:

```ts
profile: async (ctx) => ctx.inputProfiles.get(`account.${ctx.scopedStore.scope('flow').get('account.type')}`)
```

The resolved profile drives UI prompt, device options, validators, error message keys, and trace safety.

## Validation policy

Local validation remains inside the current userInput node:

- length
- format
- checksum
- amount range
- required value
- QR payload parsing

Business/host/device validation should be a separate node:

```text
enterMobilePhone -> verifyMobilePhoneWithHost -> next
                  <- reenter with error on host failure
```

Validation result never directly mutates UI. The executor converts result into `UiPort.patchState` feedback, TTS, audit, attempt count, and retry/reentry behavior.

## Timeout policy

Project preset may define default user input timeout:

```ts
policies: {
  userInputTimeout: {
    timeoutMs: 30_000,
    onTimeout: { type: 'next', nodeId: 'returnToMainMenu' }
  }
}
```

Node override is allowed.

## Interrupt policy

Flow interrupts support priority, project defaults, and node overrides:

```ts
interrupts: [
  {
    id: 'card.removed',
    priority: 100,
    eventTopic: 'device.card.removed',
    action: { type: 'cancelFlow', reasonCode: 'CARD.REMOVED' }
  }
]
```

Interrupts execute `flow.finally`.

## Parallel and race

Race is used to wait for first user input, cancel, timeout, or device interrupt. Parallel is used for concurrent pre-checks such as cash unit, printer, SIU, network, and host connectivity.

## Subflow

Subflows can be synchronous or asynchronous:

```text
kiosk.withdrawal
  -> subflow device.precheck
  -> subflow customer.authentication
  -> subflow host.withdrawal
  -> subflow cash.dispense
  -> subflow receipt.print
```

## Retry and idempotency

Retries are explicit and default off.

Idempotency is supported at:

- Command execution.
- Flow start.
- Side-effect node/effect.
- Operation ledger.

High-risk side effects such as host request, payment, dispense cash, and print must provide idempotency keys.

## Persistence and recovery

`FlowStore` supports memory and optional SQLite. Recovery policy:

```text
discard
manualRecover
autoRecover
```

Each flow instance stores `flowVersion`, traceId, status, current node, completed nodes, waiting conditions, and safe summaries.

## Hooks and middleware

Flow + node hooks + global middleware are supported:

```text
beforeFlowStart
afterFlowStart
beforeNodeRun
afterNodeRun
onNodeError
onNodeTimeout
onFlowInterrupt
onFlowComplete
onFlowFail
onFlowCancel
onFlowFinally
```

Hooks are used for trace, log, scoped store cleanup, transaction status, audit journal, metrics, and testing interception.

## Testing DSL

Testing harness supports mock condition, event, command, device, time, node path, and trace snapshot.

```ts
await expectFlow(kioskWithdrawalFlow)
  .withInput({ amount: 1000 })
  .mockCondition('cash.available', true)
  .mockCommand('withdrawal.amount.confirmed', { amount: 1000 })
  .expectPath(['precheck', 'enterAmount', 'confirmAmount', 'sendHostRequest'])
  .expectCompleted();
```

## Executable runtime

`ExecutableFlowEngine` is the production implementation of the `FlowEngine`
contract. Production applications and `FlowTestRunner` share its node execution
semantics.

```ts
const engine = createFlowEngine({
  devices,
  deviceLocks,
  inputSources,
  scopedStore,
  projection: new UiPortFlowProjectionAdapter(ui),
});

engine.register(withdrawalFlow);
const instance = await engine.start(withdrawalFlow.id, input, {
  signal: operationSignal,
});
const result = await instance.completion;
```

The engine owns definition/version lookup, instance state, node transitions,
effects, hooks, timeout, interrupt, pause/resume, cancellation, catch/finally,
subflow execution, safe trace, and UI projection.

React must not own a flow instance's cancellation controller or infer business
transitions from component lifecycle. React renders the `UiPort` projection and
submits user intent through commands or registered input sources.

Completed snapshots are bounded in memory. The default retention is the most
recent 100 instances and can be configured with
`completedInstanceRetention.maxCount`; set it to `0` when a durable `FlowStore`
is the only history source.

`FlowTestRunner` uses the same runtime with a test-only stop policy for
`stay`/`reenter`, allowing validation assertions without creating a second
execution model.
