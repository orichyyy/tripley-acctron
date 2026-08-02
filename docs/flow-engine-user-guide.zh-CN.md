# Flow Engine 使用手册（简体中文）

本文说明如何使用 `@tripley-kit/web-container-flow-engine` 设计、运行、集成、扩展和测试流程。
正文首先面向业务应用开发者，后续章节同时覆盖框架维护者与插件开发者需要的扩展机制。

本文同时描述仓库中的当前可执行实现与目标设计。尚不能执行的能力均明确标记为
**规划中（Planned）**。

## 1. 能力状态

本文使用以下状态标记：

- **当前可用（Available now）**：已由 `ExecutableFlowEngine` 实现，当前代码可以执行。
- **部分可用（Partial）**：已出现在公开类型中，或实际语义比目标设计更窄。
- **规划中（Planned）**：仅代表设计意图，生产代码不能依赖。

| 能力 | 状态 | 当前行为 |
| --- | --- | --- |
| 显式注册与启动流程 | 当前可用 | 按 ID 和版本注册定义，再显式启动。 |
| `action`、`decision`、`terminal` 节点 | 当前可用 | 引擎自动注册内置 executor。 |
| `userInput` 节点 | 当前可用 | 支持多个 adapter、设备锁、校验、反馈、总超时、空闲超时和安全摘要。 |
| `waitEvent` 节点 | 部分可用 | 暂停实例，由应用显式调用 `resume()`；不会自行订阅 Event Bus。 |
| 同步与异步 `subflow` | 当前可用 | 必须预先注册指定版本的子流程。 |
| 自定义节点 executor 与 effect runner | 当前可用 | 通过引擎 registry 注册。 |
| hook、projection、catch/finally | 当前可用 | 全局 hook 先于流程定义中的 hook 执行。 |
| 流程与节点超时 | 当前可用 | 超时会取消或令当前内存执行失败。 |
| 显式重试结果 | 当前可用 | 流程级 retry policy 控制总尝试次数和固定退避。 |
| 暂停、恢复、取消、外部 abort | 当前可用 | API 暂停在节点边界生效；wait/pause 结果立即挂起。 |
| interrupt promise 与策略路由 | 当前可用 | 启动时传入的单个 interrupt promise 最多消费一次。 |
| 输入/输出校验 | 当前可用 | validator 分别在流程启动和成功结束时执行。 |
| 已完成实例的内存保留 | 当前可用 | 默认保留最近 100 个 snapshot。 |
| `parallel` 与 `race` executor | 规划中 | 类型词汇中存在，但没有内置 executor。 |
| compensation 执行 | 规划中 | policy 和 node kind 已定义，运行时尚不执行。 |
| 持久化 `FlowStore` 与重启恢复 | 规划中 | recovery 类型已存在；实例目前只保存在内存。 |
| JSON schema 导入/导出 | 规划中 | 当前主格式是 TypeScript DSL。 |
| 并发策略执行 | 规划中 | `FlowConcurrencyPolicy` 已定义但引擎不执行。 |
| Event Bus 自动启动或自动恢复等待 | 规划中 | 启动与恢复均由应用显式负责。 |

## 2. 整体设计与心智模型

流程定义（flow definition）是不可变配置；流程实例（flow instance）是某个已注册版本的一次
内存执行。引擎负责执行并向外发布安全状态；UI 组件只负责渲染状态和提交用户意图，不负责推导
业务流转。

```text
应用命令 / 运行时
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
       |                    +--> effect runner
       |                    +--> hook / timeout / interrupt
       |
       +--> projection port -------> UiPort / 诊断系统
       +--> input adapter ---------> UI command / PIN pad / QR / 设备
       +--> ScopedStore -----------> 流程中间值
```

主要边界如下：

- `ExecutableFlowEngine` 管理定义、实例、registry 和已完成 snapshot。
- `FlowInstanceRuntime` 管理状态、当前节点、路径、trace、重试次数、取消与挂起。
- `FlowNodeRuntime` 选择 executor，并统一处理 hook、节点超时、interrupt 和 effect。
- Node executor 只实现一种节点类型；内置 executor 有意保持精简。
- `FlowProjectionPort` 是对外只读模型，不应包含敏感输出。
- `InputSourceRegistry`、`DeviceRegistry`、`DeviceLockManager` 将设备副作用限制在系统边缘。
- `ScopedStore` 是当前节点之间传递中间输出的通道。

流程具有图结构，但当前运行时按顺序执行。普通跳转使用 `next` 或显式
`{ type: "next", nodeId }`。decision 返回 branch 名称，再由 `edges` 把 branch 映射到目标节点。
运行时不会用 `edges` 自动推断普通 `next`。

## 3. 安装与导入

在当前 pnpm workspace 内，将依赖添加到消费方 package：

```json
{
  "dependencies": {
    "@tripley-kit/web-container-flow-engine": "workspace:*"
  }
}
```

只从包根入口导入公开 API：

```ts
import {
  createFlowEngine,
  defineFlow,
  defineNode,
} from "@tripley-kit/web-container-flow-engine";
```

不要直接导入 `instance-runtime.ts` 等内部源码文件。

## 4. 最小可执行流程

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

`start()` 在运行时实例创建后返回，而不是等待流程完成。通过 `instance.completion` 获取最终
snapshot；通过 `instance.snapshot()` 同步读取当前时刻状态。

## 5. 定义流程

最常用字段如下：

```ts
const definition = defineFlow<Input, Output>({
  id: "domain.operation",
  version: "1.0.0",
  description: "稳定的业务描述",
  inputSchema,
  outputSchema,
  startNodeId: "prepare",
  nodes: { /* 节点 ID -> 定义 */ },
  edges: [ /* decision 分支映射 */ ],
  timeoutMs: 60_000,
  retry: { maxAttempts: 2, backoffMs: 250 },
  policies: { /* 输入超时与 interrupt */ },
  hooks: [],
  catch: (_ctx, error) => ({ type: "fail", error }),
  finally: async (ctx) => {
    await ctx.scopedStore.clearScope("flow", ctx.instanceId, "flow.finished");
  },
});
```

`defineFlow()` 当前只校验 `startNodeId` 是否存在、节点 ID 是否为空；不会在定义阶段校验所有
跳转目标、branch、不可达节点、环或 executor。错误配置可能在执行到相应节点时才暴露。

### 版本注册

同一 flow ID 可以注册多个版本。不传 `options.version` 时选择“最后注册”的版本，而不是语义化
版本号最高的版本。子流程和长期兼容接口应绑定精确版本：

```ts
engine.register(flowV1);
engine.register(flowV2);

await engine.start(flowV1.id, input, { version: "1.0.0" });
engine.unregister(flowV1.id, "1.0.0");
```

重复注册同一个 `id@version` 会抛出 `flow.definition.duplicate`。

### 输入与输出 validator

validator 是带有 `validate(value)` 的对象，可以同步或异步执行。校验并归一化后的输入成为
`ctx.input`；output validator 只在 `end` 结果时运行。

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

推荐接入能够返回窄化、归一化值的 schema adapter。TypeScript 泛型本身不提供运行时校验。

## 6. 内置节点与跳转

### Action

Action 用于执行业务动作。若 `run()` 返回 `FlowNodeResult`，运行时直接采用；其他返回值被当作
节点输出，并跳到 `node.next`；没有 `next` 时结束流程。

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

运行时会把输出写入实例 flow scope 的 `node.<nodeId>.output` 和 `lastOutput`。其中只应保存体积
有限且不敏感的数据。

### Decision

Decision 返回 branch 字符串。每个可能到达的 branch 都必须配置在 `edges` 中：

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

缺少映射时流程以 `flow.branch.missing` 失败。

### Terminal

Terminal 表示成功结束，可以用常量或函数提供输出。不显式提供输出时，使用最近一次保存的节点
输出。

### Wait event

**部分可用。** `waitEvent` 会发布 paused snapshot，并等待显式恢复：

```ts
const wait = defineNode({
  id: "waitForConfirmation",
  kind: "waitEvent",
  waitFor: { topic: "customer.confirmed", timeoutMs: 30_000 },
  next: "finish",
});

const instance = await engine.start(flow.id, input);
// 应用层事件桥确认该事件属于这个实例。
await engine.resume(instance.instanceId, { confirmed: true });
```

当前 `topic` 和 wait condition 的 `timeoutMs` 只是描述信息。引擎不会订阅事件，也不会自动让
挂起状态超时。事件桥应实现 deadline，超时后取消实例；如果后续节点需要恢复数据，可从 flow
scope 的 `resumeInput` 读取。

### Subflow

先注册子流程，再注册/启动父流程。同步 subflow 会等待子流程，并传播其输出、失败或取消；异步
subflow 立即继续并输出 `{ instanceId }`。

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

子流程启动当前只继承父流程的 abort signal 和 trace ID，不会自动继承父级 policy override、
projection override、devices、locks、logger 或自定义实例 scope；引擎级依赖仍然生效。

### Effect-first 结果

返回 `{ type: "effects", effects }` 可按顺序执行已注册的 effect runner。runner 可以返回新的结果
改变跳转；没有 runner 改变结果时，节点使用 `next`，没有 `next` 则结束。

Effect 适合可复用、可观测的副作用，不应把一整段业务流程隐藏到单个 runner 中。

## 7. 节点结果与生命周期

| Result | 运行时行为 |
| --- | --- |
| `next` | 跳到指定节点。 |
| `branch` | 从当前节点解析 branch edge。 |
| `end` | 校验输出并成功结束。 |
| `fail` | 以 `failed` 结束。 |
| `cancel` | 以 `cancelled` 结束。 |
| `pause` | 挂起；恢复后重新执行当前节点。 |
| `wait` | 挂起；恢复后跳到 `node.next`；无 `next` 时重新执行当前节点。 |
| `retry` | 在流程 retry budget 内重新执行当前节点。 |
| `effects` | 顺序执行 effect，再使用 runner 结果或 `next`。 |
| `stay` / `reenter` | 重新执行目标节点；test runner 会在这两种结果上停止。 |

实例状态包括 `running`、`paused`、`completed`、`failed` 和 `cancelled`。每次访问节点都会追加到
`snapshot.path`，包括重试和重新输入。

## 8. 错误、超时、重试、取消与 interrupt

### 错误与 `catch`

Executor 错误、节点超时、executor 缺失以及节点执行期间的 hook 错误会进入 flow `catch`。
可以返回普通跳转结果恢复，也可以返回 `fail` 保持显式失败语义。不要把取消转换成成功。

主循环无论成功、失败还是取消，最终都会执行 `finally`。清理逻辑应有界、幂等，并能处理资源只
完成了部分初始化的情况。

### 超时

- `FlowDefinition.timeoutMs` 请求以 `FLOW.TIMEOUT` 取消流程。
- `FlowNodeDefinition.timeoutMs` abort 节点 signal，并产生 `FlowNodeTimeoutError`。
- `UserInputNodeInput.timeoutMs` 覆盖默认用户输入超时。
- `idleTimeoutMs` 根据输入进度重置，是独立的用户输入空闲超时。

执行 I/O 的代码必须观察 `ctx.signal`；abort signal 无法强制停止忽略该 signal 的 promise。

### 重试

节点代码需要显式请求重试：

```ts
return transientFailure
  ? { type: "retry", reasonCode: "HOST.TEMPORARY" }
  : { type: "next", nodeId: "done", output };
```

`maxAttempts` 是总尝试次数，因此 `2` 允许一次重试。当前只有固定退避。运行时不会自动识别瞬时
错误，也不会生成幂等键。应在重试调用外创建稳定的 operation key，并保证下游操作幂等。

### 取消与暂停

```ts
await engine.cancel(instanceId, {
  source: "user",
  reasonCode: "CUSTOMER.CANCELLED",
});

await engine.pause(instanceId, "OPERATOR.PAUSED");
await engine.resume(instanceId, resumeData);
```

API pause 请求在节点边界被观察；节点返回 `pause` 则立即在节点后挂起。`resumeData` 写入 flow
scope 的 `resumeInput`。

### Interrupt

启动时传入已关联的 promise，并按 interrupt ID 配置策略：

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

第一个 interrupt 最多消费一次。`eventTopic` 当前只是元数据，promise 必须由外部桥接层创建。
`appliesTo` 当前匹配 node ID 或 node kind，不是任意 condition ID。

## 9. User input 详解

`userInput` 节点协调 input adapter 和设备锁，执行过程如下：

1. 解析动态 profile、UI 状态、validation 和 sources。
2. 通过 `evaluateCondition` 计算每个 source 的 `enabledWhen`。
3. 为所有声明的 `deviceId` 一次性获取 lease。
4. 校验并启动符合条件的 source adapter。
5. 竞争 source 结果、总超时、空闲超时、interrupt 和 abort。
6. 发出安全 trace/log 摘要及 validation feedback。
7. 在 `finally` 中取消未完成 session 并释放 lease。

启动流程前注册所有输入类型：

```ts
const inputSources = new InputSourceRegistry();
inputSources.register(uiCommandAdapter);
inputSources.register(pinPadAdapter);

const engine = createFlowEngine({ inputSources });
```

本地 validation 适合语法、长度、校验和、解析和范围检查。Host、业务或设备校验推荐放在独立
action 节点中。虽然存在 `business` validation callback，但拆分远程工作更有利于重试、遥测和
路径可读性。

安全输入建议：

- 适用时同时设置节点 `security: "secure"` 和 adapter/source `secure: true`。
- 只返回不透明的加密材料或 token，禁止返回明文 PIN。
- Adapter 提供 `safeSummary`，敏感信息不得进入 feedback 或应用日志。
- 安全节点使用 `trace.safeToLog: false` 和 `summaryOnly: true`。
- 除非 adapter 结果已经安全，否则把 flow-scope 节点输出视为敏感数据。

部分输入配置目前只是声明性信息，或没有完全执行。特别是 `acceptance.firstValidWins`、
validation 的 `failure.mode/maxAttempts` 以及 `cleanup.cancelDevicesOnExit`，不会在当前 race、
re-entry 和 cleanup 行为之外提供额外约束。尝试次数应像 `apps/kiosk-example` 一样由应用操作层
执行预算控制。

## 10. 生产集成

### 引擎组合

为应用 runtime 创建一个共享引擎，并注入基础设施：

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

应用关闭时调用 `await engine.dispose()`，它会取消活动实例并清空内存历史。不要在每次 React
render 时创建引擎。

Start options 可以为单个实例覆盖 devices、locks、store、logger、policies 和 projection。
Policy 优先级依次为：已注册的 `flow.defaults`、engine defaults、definition policies、start
options。

### UI 与 React 边界

`UiPortFlowProjectionAdapter` 在以 `flowInstanceId` 为 scope 的 `flow.instance` key 下发布精简
projection，且不包含原始节点输出或 terminal 输出。

推荐职责划分：

- 应用/runtime 层创建并销毁引擎。
- Command handler 启动或取消流程。
- React 渲染 projection，并派发 command/input submission。
- React 组件卸载不隐式取消业务工作。
- Runtime 将 UI submission 与当前 interaction identity 关联。

真实组合示例位于 `apps/kiosk-example/src/runtime/create-runtime.ts`：它创建共享 registry、lock、
store 和 UI，注册相关联的输入 adapter，创建 projection，并在 kiosk runtime 后销毁 flow
engine。

`apps/kiosk-example/src/runtime/input-runner.ts` 展示 operation 边界：创建一个短生命周期且有关联
身份的单节点输入流程，传入 devices、locks、abort signal 和 feedback callback，等待流程完成，
最后在 `finally` 中注销唯一的流程定义。

### Event Bus 桥接

引擎当前不内置事件订阅，因此关联与订阅应留在引擎外：

```ts
const instance = await engine.start(waitingFlow.id, input);
const unsubscribe = eventBus.subscribe("customer.confirmed", async (event) => {
  if (event.operationId !== operationId) return;
  unsubscribe();
  await engine.resume(instance.instanceId, event);
});
```

生产实现还必须在完成/取消时解除订阅并实现 deadline。禁止使用可能恢复错误实例的全局事件。

### 业务服务

`FlowExecutionContext` 有意不提供通用 `services` 属性。可使用以下模式：

- Flow factory 通过闭包捕获窄接口服务。
- 注册在构造器中接收服务的自定义 node executor。
- `ScopedStore` 只保存不透明 operation ID，不保存服务对象。

应用特有逻辑优先使用 flow factory；可复用插件能力优先使用自定义 executor。

### Scoped Store

实例中间值使用 `scope("flow", ctx.instanceId)`。只有 transaction 生命周期确实长于 flow 时才使用
transaction scope。在 `finally` 清理 flow scope，且不得依赖内存 store 进行崩溃恢复。

### Logging、hook 与 projection

Hook 适合 trace 关联、指标、审计边界和测试拦截。Hook 位于执行路径内，必须快速且明确处理
失败。Projection 用于当前安全状态，trace 用于有界诊断事件；持久审计应由独立服务负责。

## 11. 扩展集成

### 自定义 node executor

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

Kind 应使用命名空间。Executor 承载能力集成，definition 只保存声明性的 operation 数据。

### Effect runner

为带命名空间的 effect kind 注册 `EffectRunner`，再从节点返回 effects result。Runner 顺序执行。
在为 effect 开启外围重试前，应先定义其幂等语义以及重复调用的结果。

### Policy registry

注册 kind 为 `flow.defaults` 的 policy 可以贡献基础 `FlowPolicies`。只有运行时已解释的内置 policy
字段具备行为；任意自定义 policy key 可由自定义 executor 通过 `ctx.policies` 读取。

## 12. Withdrawal 完整示例

完整定义位于 `examples/flow.definition.example.ts`。

执行路径如下：

```text
enterAmount -> enterPin -> authorize -> routeAuthorization
                                      -> approved
                                      -> rejected

enterAmount / enterPin 超时 ---------> timedOut
card.removed interrupt --------------> cancelled
```

关键点：

- `enterAmount` 让物理 PIN pad 数据源与相关联的 UI command source 进行竞争。
- Local validation 将获胜结果归一化成 number。
- `enterPin` 同时把节点和 source 标记为 secure，并声明退出清理。
- `authorize` 从 `node.enterAmount.output` 读取金额；确定性示例代码标出了注入 host port 的位置。
- `routeAuthorization` 返回 branch，`edges` 覆盖两个可能映射。
- Terminal 节点构造有类型且安全的业务输出。
- `finally` 清理当前实例的 flow scope。

实际执行时，需要为 `pinpad.data`、`ui.command`、`pinpad.pin` 组合 adapter，再注册定义并以
`{ accountId, approve }` 启动。示例有意不伪造生产设备 adapter。

## 13. 测试

`FlowTestRunner` 使用相同的 engine 与内置 executor。通过构造器注册 fake input adapter、自定义
executor 和 effect runner：

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

至少测试：

- 每个 decision branch 和 terminal 状态。
- 非法输入、总超时、空闲超时、abort、interrupt 及其清理。
- 节点超时与 catch 行为。
- 重试耗尽与稳定幂等键复用。
- 安全 trace/log 脱敏。
- 同步子流程失败/取消传播。
- Projection 不包含原始敏感输出。

`expectFlow()` 当前只返回 `FlowTestRunner`，并不是旧设计材料中展示的 fluent assertion API。
请使用 `runner.run()` 配合普通 Vitest assertion。

## 14. 推荐最佳实践

1. 每个节点只表达一个可观测的业务步骤。
2. 把远程校验建模为独立 action，不与本地输入校验混在一起。
3. 对有业务含义的结果使用显式 terminal 节点。
4. Flow ID 和自定义 kind 使用稳定命名空间；subflow 固定精确版本。
5. 在系统边界执行校验并返回归一化数据。
6. 副作用放在边缘，可重试副作用必须幂等。
7. 所有可取消 I/O 都要传入并观察 `ctx.signal`。
8. 把 UI input、event、interrupt 和 instance ID 关联到同一个 operation。
9. 只投影安全状态，不把原始 snapshot 直接暴露给 UI。
10. Secret 不得进入 output、feedback、trace、logger metadata 或长期 store。
11. 使用 `finally` 做幂等清理，并始终释放外部订阅。
12. 等待 `completion` 并检查 `status`，不能把“已启动”当成“成功完成”。
13. 限制内存历史数量，并通过独立机制导出持久审计。
14. 使用 `FlowTestRunner` 按生产运行时语义测试流程定义。

应避免以下反模式：

- 用一个巨型 action 节点容纳整笔交易。
- React effect 重复启动流程，或在组件卸载时取消业务流程。
- 对兼容性敏感的子流程使用隐式“最后注册版本”。
- 误以为 `waitEvent` 会订阅 Event Bus。
- 依赖只有类型、尚未实现的 `parallel`、`race`、recovery 或 compensation。
- 在没有幂等设计时重试 host 或物理设备副作用。
- 把明文 PIN、卡数据、token 或完整 host message 写入 flow scope/trace。

## 15. 当前限制与规划方向

以下公开类型表达了目标架构，但必须补齐运行时实现后才能使用：

- `parallel` 与 `race` 的内置 executor 及调度语义。
- Compensation 的注册、顺序与失败语义。
- 持久实例存储、checkpoint、重启加载和 recovery mode。
- Concurrency key/reject/queue 策略执行。
- 面向相关事件等待与 deadline 的 Event Bus 集成。
- 超出 start-node 存在性检查的静态图校验。
- Fluent `expectFlow()` assertion DSL。
- User-input 尝试次数与 cleanup 配置的完整执行。
- Definition-level trace policy 的运行时应用。

实现这些能力时应保持 status 与 snapshot 语义向后兼容，或发布新的 flow 版本。不要在应用代码中
使用同名概念模拟这些能力而不建立清晰的兼容边界。

## 附录 A：公开 API 索引

### Definition DSL

- `defineFlow(definition)`：执行最小定义校验并返回 definition。
- `defineNode(node)`：任意节点的类型 identity helper。
- `defineUserInputNode(node)`：用户输入节点的类型 identity helper。
- `bindFlowVersion(definition)`：返回 `{ flowId, version }`。

### Engine

- `createFlowEngine(options)`：创建 `ExecutableFlowEngine` 并注册 built-in executor。
- `ExecutableFlowEngine`：生产内存实现与 registry owner。
- `FlowEngine`：注册、启动、生命周期控制、查询和销毁接口。
- `FlowInstance`：实例标识、`snapshot()` 与 `completion` promise。
- `FlowStartOptions`：精确版本/ID、trace、取消、依赖、policy 和 projection override。
- `FlowEngineOptions`：registry、共享依赖、hook、projection、retention 和 ID factory。
- `FlowCancellationReason`、`FlowInstanceFilter`、`FlowProjectionPort`：生命周期辅助契约。

### Definition 与运行时契约

- `FlowDefinition`、`FlowNodeDefinition`、`AnyFlowNodeDefinition`、`FlowEdge`。
- `ActionFlowNodeDefinition`、`DecisionFlowNodeDefinition`、`WaitEventFlowNodeDefinition`、
  `TerminalFlowNodeDefinition`、`SubflowNodeDefinition`、`UserInputNodeDefinition`。
- `FlowNodeResult`、`FlowInstanceSnapshot`、`FlowExecutionContext`、`FlowValidator`。
- `FlowRetryPolicy`、`FlowPolicies`、`FlowInterruptPolicy`、`FlowRecoveryPolicy`、
  `FlowCompensationPolicy`、`TraceSummaryPolicy`。
- `FlowHook`、`FlowHookName`、`FlowHookEvent`、`FlowErrorHandler`、`FlowFinallyHandler`。

### 扩展能力

- `FlowNodeExecutorRegistry`、`EffectRunnerRegistry`、`FlowPolicyRegistry`。
- `FlowNodeExecutor`、`EffectRunner`、`FlowPolicy`。
- 内置 executor：`ActionNodeExecutor`、`DecisionNodeExecutor`、`WaitEventNodeExecutor`、
  `TerminalNodeExecutor`、`SubflowNodeExecutor`、`UserInputNodeExecutor`。
- `FlowNodeRuntime`、`FlowNodeTimeoutError` 只有在未来加入包根导出后才是公开入口；当前属于内部
  实现，不应直接导入。

### User input

- `InputProfile`、`InputConstraints`、`InputProfileResolver`。
- `UserInputSourceDefinition`、`UserInputValidationDefinition`、
  `UserInputValidationResult`、`UserInputNodeInput`。
- `UiRouteState`、`UiRouteResolver`、`UiFeedbackState`。
- `summarizeUserInputResult()`：在正确传入 secure 标记时创建安全摘要。

### Projection 与测试

- `UiPortFlowProjectionAdapter`、`CompositeFlowProjection`、`toFlowUiProjection()`。
- `FlowUiProjection`、`UiPortFlowProjectionOptions`。
- `FlowTestRunner`、`FlowTestRunnerRegistries`、`FlowTestRunnerOptions`、`expectFlow()`。

## 附录 B：Q&A

### 为什么 `start()` 返回时流程还没有完成？

它返回的是 `FlowInstance`。请等待 `instance.completion` 并检查最终状态。

### 目标节点明明存在，为什么 decision 仍然失败？

Decision 路由要求 `edges` 同时匹配 `from` 和 `branch`。仅存在目标节点还不够。

### 发布事件后，`waitEvent` 为什么没有恢复？

当前 executor 不订阅 Event Bus。需要增加有关联的应用事件桥，并调用
`engine.resume(instanceId, event)`。

### 为什么启动了错误的流程版本？

不指定版本时，引擎选择最后注册的版本。特别是 subflow，应始终传入精确版本。

### 为什么取消没有立即停止网络或设备调用？

运行时只负责 abort `ctx.signal`，被调用 API 必须观察该 signal。对无法取消的 API 应进行封装或
替换，并用 operation fencing 防止迟到结果产生副作用。

### 中间结果应该保存在哪里？

节点输出会自动写入 flow scope 的 `node.<nodeId>.output` 和 `lastOutput`。只保存体积有限的安全
值，并在 `finally` 清理该 scope。

### 如何注入 host 或业务服务？

使用 flow factory 通过闭包捕获窄接口，或创建在构造器中接收该接口的自定义 executor。
`FlowExecutionContext` 不提供通用 service locator。

### 可以让两个节点并行执行吗？

当前没有内置支持。`parallel` 和 `race` 只是规划中的 kind。不要在 action 中隐藏无界并发；确有
需要时，使用语义明确且充分测试的自定义 executor。

### 进程重启后，引擎能恢复活动流程吗？

不能。当前实例和保留的 snapshot 都在内存中；recovery 类型目前只代表设计意图。

### `snapshot.trace` 可以直接发送到 UI 或中心日志吗？

不能一概保证安全。User input 在正确配置后会产生安全摘要，但自定义节点和 hook 可以记录任意
metadata。每个边界都必须审查并脱敏；UI 渲染应使用安全 projection。

### 为什么测试遇到非法输入后停止，而不是继续循环？

`FlowTestRunner` 为 `stay` 和 `reenter` 提供测试专用 stop policy，使测试可以直接断言 feedback，
避免无限输入循环。

### 什么时候应该使用 subflow，而不是普通节点？

当该单元拥有独立版本契约、明确输入输出、独立测试，并会被多个父流程复用时使用 subflow；只
属于父流程生命周期的一个步骤应使用普通节点。
