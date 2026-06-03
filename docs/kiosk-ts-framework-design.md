# Kiosk TypeScript Frontend Foundation 设计文档 V2

> 目标读者：架构负责人、核心框架开发者、使用 Codex / AI Coding Agent 落地实现的开发者。  
> 适用场景：运行在 Tauri、Electron、WebView2、Browser/WebView 等 Web Container 中的 Kiosk / ATM / 自助终端前端应用。  
> 文档状态：V2 设计。重点降低 Flow Step 使用心智负担，可作为 MVP 编码实现依据。

---

## 1. 背景与目标

当前要创建一个 TypeScript 前端基础框架，用于承载不同客户、不同业务、不同硬件组合的 Kiosk 应用。应用主要运行在医院、航空、银行 ATM 等自助设备上。不同运行容器，例如 Tauri、Electron、WebView2，会通过统一 Native API 暴露硬件、窗口、日志、Electronic Journal、网络通信等能力。

本框架的核心目标是：

1. 业务逻辑与 UI 框架隔离。
2. 业务逻辑与具体 Native Container 隔离。
3. 支持复杂交易流程，包括硬件事件、客户输入、超时、取消、错误恢复、Host 通信、日志和 EJ。
4. 支持多客户、多协议、多硬件供应商、多窗口、多屏幕扩展。
5. 提供类型安全的 EventBus / CommandBus / QueryBus 和 Plugin 系统。
6. 提供可视化 Flow 文件执行能力，同时允许复杂步骤使用 TypeScript 编写。
7. 支持无 UI、无真实硬件的自动化测试。

最终希望业务开发者多数情况下只关心：

```ts
Recipes.inputAccount({
  id: "inputAccount",
  screen: "account.input",
  saveAs: "accountNo",
  routes: {
    valid: "AccountInquiry",
    cancel: "Cancelled",
    timeout: "Timeout",
  },
});
```

或者在需要更灵活时使用标准 Step Builder：

```ts
defineTextInputStep({
  id: "inputAccount",
  screen: "account.input",
  sources: [
    InputSources.pinpad.numeric(),
    InputSources.barcode.qr({ parse: parseAccountFromQrCode }),
    InputSources.ui.action(),
  ],
  validate: accountNoValidator,
  commit: (ctx, accountNo) => ctx.transaction.set("accountNo", accountNo),
  routes: { accepted: "Valid", cancelled: "Cancelled", timeout: "Timeout" },
});
```

而不是关心：

```ts
router.push(...);
reactStore.setState(...);
electron.ipcRenderer.invoke(...);
tauri.invoke(...);
ctx.scope.race(...);
ctx.scope.onDispose(...);
ctx.devices.pinpad.cancel();
```

### 本版关键更新

V2 相比初版最大的调整是：Flow Step 不再默认鼓励业务开发者直接编写裸 `async ctx => { ... }`。

新的 Step 体系分为四层：

1. `Recipes.*`：最简单的业务模板，适合 80% 常见交易步骤。
2. `defineTextInputStep` / `defineChoiceStep` / `defineConfirmStep` 等标准 Step Builder，适合大多数可配置交互。
3. `defineInteractionStep`：Reducer 风格复杂交互，适合多输入源、多状态变化的步骤。
4. `defineRawStep`：底层 escape hatch，仅用于极复杂场景或框架内部。

底层的 `StepScope`、`race`、`AbortSignal`、timeout、device cancel、audit、EJ、more time dialog 仍然保留，但由 `InteractionRuntime` 和 Step Kit 默认接管。

---

## 2. 总体设计原则

### 2.1 Ports and Adapters

框架核心只依赖抽象接口，不依赖具体实现。

典型抽象包括：

- `UiPort`
- `NativeBridge`
- `DeviceManager`
- `HostGateway`
- `Logger`
- `ElectronicJournal`
- `WindowManager`
- `TtsService`
- `VoiceGuideService`

具体实现通过 Plugin 注入。

### 2.2 Flow Graph 负责流程结构，Step Kit 负责交互意图

可视化 Flow 文件适合描述：

- 从哪个节点开始。
- 每个节点之后走哪条边。
- Subflow 如何复用。
- 成功、失败、取消、超时等出口。

但 ATM / Kiosk 业务步骤经常同时处理 UI、Pinpad、Barcode、Timeout、More Time Dialog、Cancel、Host 请求、Promise race、硬件 cancel、交易资源恢复。

如果让业务开发者每个 Step 都写裸 `while + race + event + timeout + cleanup`，心智负担会很高。因此本框架采用新的分层：

```txt
Flow JSON: 描述流程结构
Step Recipe: 描述常见业务模板
Standard Step Builder: 描述输入、选择、确认、Host 请求、等待设备等标准交互
Interaction Step: 使用 reducer 描述复杂状态变化
Raw Step: 仅作为 escape hatch
StepScope: 底层生命周期与取消能力，由框架内部优先使用
```

核心设计转变：

```txt
初版：Flow step = 一段可以自由操作 ctx 的 async function
V2： Flow step = 声明一个交互意图，框架负责执行交互生命周期
```

业务开发者负责：

- 这个步骤要收集什么。
- 从哪里收集，例如 UI、Pinpad、Barcode、Host、Supervisor。
- 怎么校验。
- 成功后保存什么。
- 不同结果走哪条边。

框架负责：

- 显示 UI 和 patch UI。
- 监听硬件和 UI 事件。
- 多输入源 race。
- timeout 和 more time policy。
- cancel policy。
- audit log 和 Electronic Journal。
- 自动 cancel 硬件。
- 防止 Step 结束后 Promise 回调污染流程。
- 未处理错误恢复。

### 2.3 Step 必须有生命周期边界

每个 Step 都运行在独立 `StepScope` 中。Step 结束时，框架必须自动：

1. Abort 当前 Step 的 `AbortSignal`。
2. 取消事件订阅。
3. 取消 Timeout。
4. 调用已注册的硬件 cancel。
5. 阻止 Step 结束后遗留 Promise 的 `.then()` 继续影响 UI 或流程。
6. 回收 Step 资源。

### 2.4 所有客户差异通过 Config、Plugin、Mapper、Policy 扩展

不同客户的差异不应该污染核心框架。典型客户差异包括：

- Host message 格式不同。
- Timeout 后行为不同。
- More Time Dialog 规则不同。
- 日志脱敏规则不同。
- 硬件供应商不同。
- UI 主题或流程不同。
- 维护模式和 Host command 格式不同。

这些都通过 Plugin / Config / Policy / Mapper 处理。

---

## 3. 推荐 Monorepo 目录结构

```txt
kiosk-framework/
  package.json
  tsconfig.base.json
  pnpm-workspace.yaml
  vitest.config.ts

  packages/
    core/
      src/
        index.ts
        kernel/
        event-bus/
        command-bus/
        query-bus/
        plugin/
        service-registry/
        lifecycle/
        config/
        logging/
        errors/
        types/

    flow/
      src/
        index.ts
        engine/
        compiler/
        graph/
        runtime/
        step/
        step-kit/
        recipes/
        interaction/
        input-sources/
        policies/
        scope/
        testing/

    ui/
      src/
        index.ts
        screen-contract/
        ui-port/
        headless/
        react/

    platform/
      src/
        index.ts
        native-bridge/
        browser/
        tauri/
        electron/
        webview2/
        headless/

    plugins/
      logging/
      electronic-journal/
      timeout/
      devices/
      host/
      tts/
      voice-guide/
      window-manager/
      operational-state/
      recovery/
      interaction-audit/

    testing-kit/
      src/
        index.ts
        fake-devices/
        fake-host/
        headless-ui/
        virtual-clock/
        flow-test-runner/

    app-sdk/
      src/
        index.ts
        transaction-kit/
        step-templates/
        app-builder/

  examples/
    atm-basic/
    atm-with-supervisor/
    headless-flow-test/

  docs/
    architecture.md
    plugin-authoring.md
    flow-authoring.md
    testing.md
```

---

## 4. 核心 Runtime 架构

核心 Runtime 负责组装整个应用。

```ts
export interface KioskAppOptions {
  role: RuntimeRole;
  plugins: KioskPlugin[];
  config?: ConfigSource[];
}

export type RuntimeRole =
  | "mainCustomerScreen"
  | "supervisorScreen"
  | "operatorScreen"
  | "diagnosticScreen"
  | "headlessTest";

export interface KioskApp {
  start(): Promise<void>;
  stop(): Promise<void>;
  events: TypedEventBus<KioskEvents>;
  commands: TypedCommandBus<KioskCommands>;
  queries: TypedQueryBus<KioskQueries>;
  services: ServiceRegistry;
}
```

应用创建：

```ts
const app = createKioskApp({
  role: "mainCustomerScreen",
  plugins: [
    coreLoggingPlugin(),
    coreConfigPlugin(),
    browserUiPlugin(),
    nativeBridgePlugin(),
    devicePlugin(),
    timeoutPlugin(),
    recoveryPlugin(),
    flowEnginePlugin(),
    customerHostPlugin(),
  ],
});

await app.start();
```

---

## 5. ServiceRegistry

### 5.1 设计目标

`ServiceRegistry` 用于在 Plugin 之间提供和获取服务，避免全局单例和隐式依赖。

### 5.2 类型安全 ServiceToken

```ts
export interface ServiceToken<T> {
  readonly id: string;
  readonly description?: string;
}

export function createServiceToken<T>(
  id: string,
  description?: string
): ServiceToken<T> {
  return { id, description };
}
```

### 5.3 Registry 接口

```ts
export interface ServiceRegistry {
  provide<T>(token: ServiceToken<T>, value: T, options?: ProvideOptions): void;
  get<T>(token: ServiceToken<T>): T;
  tryGet<T>(token: ServiceToken<T>): T | undefined;
  has<T>(token: ServiceToken<T>): boolean;
}

export interface ProvideOptions {
  override?: boolean;
  multi?: boolean;
}
```

### 5.4 规则

1. 默认同一个 token 只能被 provide 一次。
2. 如需替换，必须显式 `override: true`。
3. 多 provider 场景必须显式 `multi: true`。
4. 启动时如果依赖缺失，应立即失败。

---

## 6. EventBus / CommandBus / QueryBus

框架不建议只用一个 EventBus 解决所有问题，而是拆成三类。

### 6.1 EventBus：已经发生的事实

Event 表示已经发生的事实，不应该要求返回值。

示例：

```txt
core.app.started
device.pinpad.keyPressed
ui.action.performed
host.command.received
transaction.started
transaction.ended
service.state.changed
```

接口：

```ts
export interface KioskEvents {}

export interface TypedEventBus<Events> {
  publish<K extends keyof Events>(
    name: K,
    payload: Events[K]
  ): Promise<void>;

  subscribe<K extends keyof Events>(
    name: K,
    handler: EventHandler<Events[K]>,
    options?: SubscribeOptions
  ): Disposable;

  wait<K extends keyof Events>(
    name: K,
    options?: WaitEventOptions<Events[K]>
  ): Promise<Events[K]>;
}

export type EventHandler<T> = (payload: T) => void | Promise<void>;

export interface Disposable {
  dispose(): void | Promise<void>;
}
```

### 6.2 CommandBus：请求某个能力做事

Command 可以有返回值，也可以失败。

示例：

```txt
ui.show
device.cardReader.eject
host.send
journal.write
window.open
```

接口：

```ts
export interface KioskCommands {}

export interface CommandDef<Request, Response> {
  request: Request;
  response: Response;
}

export interface TypedCommandBus<Commands> {
  execute<K extends keyof Commands>(
    name: K,
    request: Commands[K] extends CommandDef<infer Req, any> ? Req : never
  ): Promise<Commands[K] extends CommandDef<any, infer Res> ? Res : never>;

  handle<K extends keyof Commands>(
    name: K,
    handler: CommandHandler<Commands[K]>
  ): Disposable;
}
```

### 6.3 QueryBus：查询当前状态

Query 适合查询当前运行状态。

示例：

```txt
service.getState
device.getStatus
transaction.getCurrent
config.get
```

接口：

```ts
export interface KioskQueries {}

export interface QueryDef<Request, Response> {
  request: Request;
  response: Response;
}

export interface TypedQueryBus<Queries> {
  query<K extends keyof Queries>(
    name: K,
    request: Queries[K] extends QueryDef<infer Req, any> ? Req : never
  ): Promise<Queries[K] extends QueryDef<any, infer Res> ? Res : never>;

  handle<K extends keyof Queries>(
    name: K,
    handler: QueryHandler<Queries[K]>
  ): Disposable;
}
```

---

## 7. 类型扩展机制

Core 定义空接口，Plugin 通过 module augmentation 扩展。

```ts
// @kiosk/core
export interface KioskEvents {}
export interface KioskCommands {}
export interface KioskQueries {}
```

Core Plugin 扩展：

```ts
declare module "@kiosk/core" {
  interface KioskEvents {
    "core.app.started": { startedAt: number };
    "transaction.started": { transactionId: string; flowId: string };
    "transaction.ended": {
      transactionId: string;
      result: "success" | "failed" | "cancelled";
    };
  }
}
```

Device Plugin 扩展：

```ts
declare module "@kiosk/core" {
  interface KioskEvents {
    "device.pinpad.keyPressed": {
      key: PinpadKey;
      deviceId: string;
      timestamp: number;
    };
  }
}
```

业务代码订阅时自动获得类型：

```ts
ctx.events.subscribe("device.pinpad.keyPressed", event => {
  event.key;
  event.deviceId;
});
```

---

## 8. Plugin 系统

### 8.1 Plugin 设计目标

Plugin 用于扩展 Core 能力。Core 自己的大部分能力也应该以 Plugin 形式注册。

Plugin 可以提供：

1. Service
2. Event handler
3. Command handler
4. Query handler
5. Config schema
6. Lifecycle hook
7. Middleware
8. Cleanup hook

### 8.2 Plugin 定义

```ts
export interface KioskPlugin {
  readonly id: string;
  readonly version: string;
  readonly dependsOn?: string[];
  readonly provides?: PluginProvides;
  setup(ctx: PluginContext): void | Promise<void>;
}

export interface PluginProvides {
  events?: string[];
  commands?: string[];
  queries?: string[];
  services?: string[];
}

export interface PluginContext {
  role: RuntimeRole;
  events: TypedEventBus<KioskEvents>;
  commands: TypedCommandBus<KioskCommands>;
  queries: TypedQueryBus<KioskQueries>;
  services: ServiceRegistry;
  config: ConfigService;
  lifecycle: LifecycleRegistry;
  logger: Logger;
}
```

### 8.3 Plugin Runtime 启动检查

启动时必须检查：

1. Plugin ID 是否重复。
2. Plugin 依赖是否存在。
3. Command handler 是否重复。
4. Query handler 是否重复。
5. Service token 是否重复。
6. Event / Command / Query 命名是否符合命名规范。
7. Config schema 是否验证通过。
8. Plugin 是否允许在当前 RuntimeRole 中运行。

### 8.4 命名规范

推荐事件、命令、服务使用命名空间：

```txt
core.*
ui.*
device.*
host.*
journal.*
window.*
flow.*
transaction.*
customer.{customerId}.*
vendor.{vendorId}.*
```

示例：

```txt
core.timeout.expired
device.pinpad.keyPressed
host.command.received
customer.bankabc.host.iso8583.message.received
vendor.ncr.pinpad.keyPressed
```

---

## 9. UI 隔离设计

### 9.1 目标

业务逻辑不依赖 React、Vue、router、Redux、Zustand、Pinia 等 UI 技术。

### 9.2 Screen Contract

每个项目定义自己的 ScreenMap。

```ts
export interface AppScreens {
  "idle": {
    state: {
      title: string;
      languages: string[];
    };
    actions:
      | { type: "start" }
      | { type: "selectLanguage"; lang: string };
  };

  "account.input": {
    state: {
      value: string;
      error?: string;
    };
    actions:
      | { type: "cancel" }
      | { type: "submit"; value: string };
  };

  "dialog.moreTime": {
    state: {
      remainingSeconds: number;
    };
    actions:
      | { type: "yes" }
      | { type: "no" };
  };
}
```

### 9.3 UiPort

```ts
export interface UiPort<Screens extends ScreenMap> {
  show<K extends keyof Screens>(
    screen: K,
    state: Screens[K]["state"]
  ): Promise<void>;

  patch<K extends keyof Screens>(
    screen: K,
    patch: Partial<Screens[K]["state"]>
  ): Promise<void>;

  openDialog<K extends keyof Screens>(
    dialog: K,
    state: Screens[K]["state"]
  ): Promise<void>;

  closeDialog(dialogId?: string): Promise<void>;

  waitAction<K extends keyof Screens>(
    screen: K,
    options?: WaitActionOptions
  ): Promise<Screens[K]["actions"]>;
}

export interface ScreenMap {
  [screen: string]: {
    state: unknown;
    actions: unknown;
  };
}
```

### 9.4 React Adapter 示例

```ts
export class ReactUiAdapter<Screens extends ScreenMap>
  implements UiPort<Screens> {
  constructor(private store: UiRuntimeStore) {}

  async show(screen, state) {
    this.store.setCurrentScreen(String(screen));
    this.store.setScreenState(state);
  }

  async patch(screen, patch) {
    this.store.patchScreenState(String(screen), patch);
  }

  async waitAction(screen, options) {
    return this.store.waitAction(String(screen), options);
  }
}
```

### 9.5 Headless Adapter

用于测试：

```ts
export class HeadlessUiAdapter<Screens extends ScreenMap>
  implements UiPort<Screens> {
  readonly history: Array<{ type: string; screen: string; payload: unknown }> = [];

  async show(screen, state) {
    this.history.push({ type: "show", screen: String(screen), payload: state });
  }

  async patch(screen, patch) {
    this.history.push({ type: "patch", screen: String(screen), payload: patch });
  }
}
```

---

## 10. NativeBridge 与 Platform Adapter

### 10.1 NativeBridge 统一契约

```ts
export interface NativeBridge {
  invoke<TReq, TRes>(
    command: string,
    payload: TReq,
    options?: NativeInvokeOptions
  ): Promise<TRes>;

  on<T>(
    eventName: string,
    handler: (payload: T) => void
  ): Disposable;
}

export interface NativeInvokeOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}
```

不同容器分别实现：

```txt
TauriNativeBridge
ElectronNativeBridge
WebView2NativeBridge
BrowserNativeBridge
HeadlessNativeBridge
```

### 10.2 业务禁止直接使用 NativeBridge

业务 Step 不应该直接写：

```ts
await native.invoke("pinpad.startKeyMode", ...);
```

而应该通过 Device Service：

```ts
await ctx.devices.pinpad.startKeyMode(...);
```

---

## 11. DeviceManager 设计

### 11.1 DeviceManager

```ts
export interface DeviceManager {
  pinpad: PinpadDevice;
  barcodeReader: BarcodeReaderDevice;
  cardReader: CardReaderDevice;
  cashDispenser: CashDispenserDevice;
  printer: PrinterDevice;
}
```

### 11.2 PinpadDevice

```ts
export type PinpadKey =
  | "0" | "1" | "2" | "3" | "4"
  | "5" | "6" | "7" | "8" | "9"
  | "enter"
  | "cancel"
  | "clear"
  | "backspace";

export interface PinpadDevice {
  startKeyMode(options: {
    allowedKeys?: PinpadKey[];
    signal?: AbortSignal;
  }): Promise<void>;

  getData(options: {
    mode: "account" | "amount" | "pin";
    minLength?: number;
    maxLength?: number;
    signal?: AbortSignal;
  }): Promise<PinpadDataResult>;

  cancel(): Promise<void>;
}
```

### 11.3 BarcodeReaderDevice

```ts
export interface BarcodeReaderDevice {
  read(options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<BarcodeResult>;

  cancel(): Promise<void>;
}
```

### 11.4 CardReaderDevice

```ts
export interface CardReaderDevice {
  waitForCard(options?: {
    signal?: AbortSignal;
  }): Promise<CardInsertedResult>;

  eject(options?: {
    timeoutMs?: number;
  }): Promise<CardEjectResult>;

  retain(reason: string): Promise<void>;

  cancel(): Promise<void>;
}
```

### 11.5 Device Session / Lease

硬件操作应支持独占和自动释放。

```ts
export interface DeviceLease<TDevice> {
  device: TDevice;
  release(): Promise<void>;
}

export interface ClaimableDevice<TDevice> {
  claim(options?: { signal?: AbortSignal }): Promise<DeviceLease<TDevice>>;
}
```

Step 中可这样使用：

```ts
const lease = await ctx.devices.pinpad.claim({ signal: ctx.scope.signal });
ctx.scope.onDispose(() => lease.release());
```

---

## 12. FlowEngine 设计

### 12.1 Flow 文件模型

Flow 文件来自 React Flow 等可视化工具生成。Flow 文件只描述流程结构，不承载复杂业务逻辑。

```ts
export interface FlowDefinition {
  id: string;
  version: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type FlowNode =
  | StartNode
  | EndNode
  | ActionNode
  | SubflowNode
  | ShortcutNode;

export interface BaseNode {
  id: string;
  type: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface StartNode extends BaseNode {
  type: "start";
}

export interface EndNode extends BaseNode {
  type: "end";
  name: string;
}

export interface ActionNode extends BaseNode {
  type: "action";
  action: string;
  config?: Record<string, unknown>;
}

export interface SubflowNode extends BaseNode {
  type: "subflow";
  flowId: string;
  input?: Record<string, unknown>;
}

export interface ShortcutNode extends BaseNode {
  type: "shortcut";
  targetRef?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  name?: string;
  condition?: string;
}
```

### 12.2 编译阶段

Flow JSON 不直接执行，必须先编译。

编译器职责：

1. 检查 start 节点只有一个。
2. 检查 end 节点 name 唯一。
3. 检查所有节点可达。
4. 检查是否存在死路节点。
5. 检查 action 是否有实现。
6. 检查 subflow 是否存在。
7. 检查 edge name 是否重复。
8. 检查 subflow end name 是否能匹配外部 edge。
9. 折叠 shortcut 节点。
10. 生成运行时图结构。

```ts
export interface FlowCompiler {
  compile(definition: FlowDefinition): CompiledFlow;
}

export interface CompiledFlow {
  id: string;
  version: string;
  startNodeId: string;
  nodes: Map<string, RuntimeFlowNode>;
  edgesBySource: Map<string, RuntimeFlowEdge[]>;
}
```

### 12.3 Step 定义分层

V2 中，`action` 不再只注册裸 `StepFunction`，而是优先注册 `StepDefinition`。

```txt
Level 1: Recipe
  - Recipes.inputAccount
  - Recipes.selectLanguage
  - Recipes.waitCardInserted
  - Recipes.ejectCard

Level 2: Standard Step Builder
  - defineTextInputStep
  - defineChoiceStep
  - defineConfirmStep
  - defineHostRequestStep
  - defineWaitDeviceStep
  - defineMediaRecoveryStep
  - defineReceiptStep

Level 3: Interaction Step
  - defineInteractionStep

Level 4: Raw Step
  - defineRawStep
```

建议使用比例：

```txt
80% 业务使用 Recipes
15% 业务使用 defineXxxStep
4% 业务使用 defineInteractionStep
1% 特殊情况使用 defineRawStep
```

### 12.4 StepRegistry

```ts
export interface StepRegistry {
  register(actionName: string, step: StepDefinition): void;
  get(actionName: string): StepDefinition;
}

export type StepDefinition =
  | RecipeStepDefinition
  | StandardStepDefinition
  | InteractionStepDefinition<any, any, any>
  | RawStepDefinition;

export interface RawStepDefinition {
  kind: "raw";
  id: string;
  run(ctx: StepContext): Promise<StepResult>;
}
```

`defineRawStep` 仍然存在，但文档应明确：普通业务不推荐默认使用它。

```ts
export function defineRawStep(
  id: string,
  run: (ctx: StepContext) => Promise<StepResult>
): RawStepDefinition {
  return { kind: "raw", id, run };
}
```

### 12.5 StepResult

```ts
export type StepResult =
  | { type: "next"; edgeName?: string; data?: unknown }
  | { type: "end"; endName: string; data?: unknown }
  | { type: "error"; error: unknown };
```

辅助方法：

```ts
ctx.next("Valid");
ctx.end("Cancelled");
ctx.end("Timeout");
```

### 12.6 Standard Step Kit

Standard Step Kit 是降低使用者心智负担的核心。它把常见交易步骤封装成声明式配置。

#### TextInputStep

适合账号、手机号、证件号、金额、OTP、参考号等输入。

```ts
export interface TextInputStepDefinition<TValue = string> {
  kind: "textInput";
  id: string;

  screen: ScreenName | ((ctx: StepContext) => ScreenRenderSpec);
  voiceGuide?: string | ((ctx: StepContext) => string | undefined);
  tts?: string | ((ctx: StepContext) => string | undefined);

  timeout?: TimeoutRef | TimeoutOptions;
  audit?: "customerInput" | false | AuditOptions;
  cancelRoute?: string;

  value?: {
    initial?: string | ((ctx: StepContext) => string);
    minLength?: number;
    maxLength?: number;
    mask?: boolean;
    redactAs?: RedactionKind;
  };

  sources: InputSource[];

  validate?: (
    value: string,
    ctx: StepContext
  ) => ValidationResult<TValue> | Promise<ValidationResult<TValue>>;

  commit?: (ctx: StepContext, value: TValue) => void | Promise<void>;

  routes: {
    accepted: string;
    cancelled?: string;
    timeout?: string;
    failed?: string;
  };
}
```

使用示例：

```ts
export const inputAccountStep = defineTextInputStep({
  id: "inputAccount",
  screen: "account.input",
  voiceGuide: "account.input",

  timeout: {
    key: "accountInput",
    durationMs: 90_000,
    policy: "askMoreTime",
  },

  value: {
    minLength: 6,
    maxLength: 18,
    mask: false,
    redactAs: "accountNo",
  },

  sources: [
    InputSources.pinpad.numeric(),
    InputSources.barcode.qr({ parse: parseAccountFromQrCode }),
    InputSources.ui.action(),
  ],

  validate(value) {
    if (value.length < 6) {
      return { ok: false, error: "Account number is too short" };
    }
    return { ok: true, value };
  },

  commit(ctx, accountNo) {
    ctx.transaction.set("accountNo", accountNo);
  },

  routes: {
    accepted: "Valid",
    cancelled: "Cancelled",
    timeout: "Timeout",
    failed: "Failed",
  },
});
```

#### ChoiceStep

适合选择账户类型、交易类型、语言、是否打印凭条、手续费确认等。

```ts
export const selectAccountTypeStep = defineChoiceStep({
  id: "selectAccountType",
  screen: "account.type.select",
  voiceGuide: "account.type.select",

  timeout: {
    key: "selectAccountType",
    durationMs: 60_000,
    policy: "askMoreTime",
  },

  choices: [
    { id: "saving", label: "Saving", route: "Saving" },
    { id: "checking", label: "Checking", route: "Checking" },
    { id: "credit", label: "Credit", route: "Credit" },
  ],

  sources: [
    InputSources.ui.choice(),
    InputSources.pinpad.functionKeys({
      f1: "saving",
      f2: "checking",
      f3: "credit",
      cancel: "cancel",
    }),
  ],

  commit(ctx, choice) {
    ctx.transaction.set("accountType", choice.id);
  },

  routes: {
    cancelled: "Cancelled",
    timeout: "Timeout",
  },
});
```

#### ConfirmStep

适合确认金额、确认转账信息、确认手续费、确认交易摘要。

```ts
defineConfirmStep({
  id: "confirmTransfer",
  screen: "transfer.confirm",

  state(ctx) {
    return {
      fromAccount: ctx.transaction.get("fromAccount"),
      toAccount: ctx.transaction.get("toAccount"),
      amount: ctx.transaction.get("amount"),
      fee: ctx.transaction.get("fee"),
    };
  },

  sources: [
    InputSources.ui.confirmCancel(),
    InputSources.pinpad.confirmCancel(),
  ],

  routes: {
    confirmed: "Confirmed",
    cancelled: "Cancelled",
    timeout: "Timeout",
  },
});
```

#### HostRequestStep

适合账户查询、授权取款、转账提交、余额查询、通知 Host 交易结果。

```ts
defineHostRequestStep({
  id: "accountInquiry",
  loadingScreen: "processing",

  request(ctx) {
    return {
      type: "accountInquiry",
      body: {
        accountNo: ctx.transaction.get("accountNo"),
      },
    };
  },

  timeout: {
    durationMs: 30_000,
    route: "HostTimeout",
  },

  mapResponse(response, ctx) {
    if (response.status === "approved") {
      ctx.transaction.set("accountInfo", response.body);
      return "Approved";
    }

    if (response.status === "declined") {
      ctx.transaction.set("declineReason", response.reason);
      return "Declined";
    }

    return "Failed";
  },

  routes: {
    Approved: "SelectTransaction",
    Declined: "ShowDeclined",
    Failed: "Failed",
    HostTimeout: "HostTimeout",
  },
});
```

#### WaitDeviceStep

适合等待插卡、等待取卡、等待取钞、等待支票放入、等待扫描完成。

```ts
defineWaitDeviceStep({
  id: "waitCardTaken",
  screen: "card.take",
  voiceGuide: "card.take",

  device: Devices.cardReader.waitTaken(),

  timeout: {
    durationMs: 30_000,
    onTimeout: "retainCard",
  },

  routes: {
    done: "Success",
    timeout: "Timeout",
    deviceError: "HardwareError",
  },
});
```

#### MediaRecoveryStep

适合退卡、吞卡、回收钞票、清理设备状态、回到 idle。

```ts
defineMediaRecoveryStep({
  id: "recoverCustomerMedia",
  screen: "please.wait",

  resources: [
    Resources.card.ejectIfPresent(),
    Resources.cash.retractIfPresented(),
  ],

  routes: {
    success: "Recovered",
    failed: "RecoveryFailed",
  },
});
```

### 12.7 Recipes

Recipe 是面向业务项目的最高层模板。Recipe 内部展开成 Standard Step Builder。

```ts
Recipes.inputAccount({
  id: "inputAccount",
  screen: "account.input",
  saveAs: "accountNo",
  routes: {
    valid: "AccountInquiry",
    cancel: "Cancelled",
    timeout: "Timeout",
  },
});
```

```ts
Recipes.waitCardInserted({
  id: "waitCardInserted",
  routes: {
    inserted: "ReadCard",
    timeout: "Timeout",
    error: "HardwareError",
  },
});
```

```ts
Recipes.ejectCard({
  id: "ejectCard",
  screen: "card.take",
  timeoutMs: 30_000,
  routes: {
    taken: "Success",
    retained: "CardRetained",
    failed: "HardwareError",
  },
});
```

Recipe 的目标不是覆盖所有场景，而是让常见交易流程能快速拼装。

### 12.8 Interaction Intent

InputSource 不直接把底层事件暴露给业务，而是转换成统一业务意图。

```ts
export type InteractionIntent =
  | {
      type: "append";
      text: string;
      source: "pinpad" | "ui" | "barcode";
    }
  | {
      type: "backspace";
      source: "pinpad" | "ui";
    }
  | {
      type: "clear";
      source: "pinpad" | "ui";
    }
  | {
      type: "submit";
      source: "pinpad" | "ui";
    }
  | {
      type: "cancel";
      source: "pinpad" | "ui" | "host" | "supervisor";
    }
  | {
      type: "scan";
      text: string;
      source: "barcode";
    }
  | {
      type: "timeout";
    }
  | {
      type: "action";
      action: string;
      payload?: unknown;
      source: "ui";
    };
```

业务开发者不需要知道 `device.pinpad.keyPressed`、`ui.button.pressed`、`barcodeReader.read()` 如何 race，InteractionRuntime 统一处理。

### 12.9 InputSource

`InputSource` 是降低复杂度的关键抽象。

```ts
export interface InputSource<TIntent extends InteractionIntent = InteractionIntent> {
  id: string;

  start(ctx: InputSourceContext): Promise<void>;

  onIntent(
    emit: (intent: TIntent) => void
  ): Disposable | Promise<Disposable>;

  stop?(): Promise<void>;
}

export interface InputSourceContext {
  scope: StepScope;
  events: ScopedEventApi;
  ui: UiPort<any>;
  devices: DeviceManager;
  logger: Logger;
  audit: InteractionAuditService;
  config: ConfigService;
}
```

内置 source：

```txt
InputSources.pinpad.numeric()
InputSources.pinpad.confirmCancel()
InputSources.pinpad.functionKeys()

InputSources.ui.action()
InputSources.ui.choice()
InputSources.ui.confirmCancel()
InputSources.ui.textInput()

InputSources.barcode.qr()
InputSources.cardReader.inserted()
InputSources.touchScreen.button()
InputSources.host.cancelCommand()
InputSources.supervisor.cancelCommand()
```

### 12.10 InteractionRuntime

`defineTextInputStep`、`defineChoiceStep`、`defineInteractionStep` 最终都由 InteractionRuntime 执行。

```ts
async function runTextInputStep(ctx: StepContext, def: TextInputStepDefinition) {
  const runtime = new InteractionRuntime(ctx, def);

  await runtime.showScreen();
  await runtime.startVoiceGuide();
  await runtime.startTimeout();
  await runtime.startSources();

  try {
    const result = await runtime.loop();
    await runtime.commitIfNeeded(result);
    return runtime.mapRoute(result);
  } finally {
    await runtime.dispose();
  }
}
```

InteractionRuntime 统一负责：

1. UI show / patch。
2. Voice Guide / TTS。
3. Timeout / More Time。
4. Cancel policy。
5. 启动和停止 InputSource。
6. 多输入源 race。
7. Audit Log 和 EJ。
8. StepScope cleanup。
9. stale promise guard。
10. device cancel。
11. unhandled error recovery。

### 12.11 Step Policy

Timeout、cancel、audit、voice guide 不应散落在业务代码里，应作为 Step Policy。

```ts
defineTextInputStep({
  id: "inputAccount",

  policies: [
    Policies.voiceGuide("account.input"),
    Policies.timeout("accountInput"),
    Policies.auditCustomerInput(),
    Policies.cancelTo("Cancelled"),
    Policies.autoCleanupDevices(),
  ],

  // business definition
});
```

为了简洁，标准 Step Builder 也可以提供常用快捷字段：

```ts
defineTextInputStep({
  id: "inputAccount",
  voiceGuide: "account.input",
  timeout: "accountInput",
  audit: "customerInput",
  cancelRoute: "Cancelled",
});
```

### 12.12 InteractionStep

标准 Step 不够时，应优先使用 reducer 风格的 `defineInteractionStep`，而不是立即退回 raw async step。

```ts
defineInteractionStep({
  id: "complexAccountInput",

  initialState(ctx) {
    return {
      mode: "manual",
      value: "",
      error: undefined,
      scanEnabled: true,
    };
  },

  render(state) {
    return {
      screen: "account.input",
      state: {
        value: state.value,
        error: state.error,
        scanEnabled: state.scanEnabled,
      },
    };
  },

  sources(state) {
    return [
      InputSources.pinpad.numeric(),
      state.scanEnabled ? InputSources.barcode.qr() : InputSources.none(),
      InputSources.ui.action(),
    ];
  },

  reduce(state, intent, ctx) {
    if (intent.type === "scan") {
      const parsed = parseAccountFromQrCode(intent.text);
      if (!parsed.ok) return { ...state, error: "Invalid QR code" };
      return ctx.accept(parsed.accountNo);
    }

    if (intent.type === "append") {
      if (state.value.length >= 18) return state;
      return { ...state, value: state.value + intent.text, error: undefined };
    }

    if (intent.type === "submit") {
      if (state.value.length < 6) {
        return { ...state, error: "Account number is too short" };
      }
      return ctx.accept(state.value);
    }

    if (intent.type === "cancel") {
      return ctx.cancel();
    }

    return state;
  },

  commit(ctx, accountNo) {
    ctx.transaction.set("accountNo", accountNo);
  },

  routes: {
    accepted: "Valid",
    cancelled: "Cancelled",
    timeout: "Timeout",
  },
});
```

好处：复杂状态仍然清晰；每次输入只是 `state -> state`；UI patch 根据 state 变化自动发生；timeout、cancel、cleanup 仍由框架处理。

### 12.13 Subflow

Subflow 执行完成后返回 endName，父 Flow 根据 endName 选择 edge。

```ts
const result = await ctx.flow.runSubflow("common.readCard", input);
return ctx.next(result.endName);
```

## 13. StepContext

StepContext 是业务步骤唯一能访问的运行时能力集合。

V2 的原则是：普通业务开发者多数情况下通过 Step Builder 配置业务意图，不直接操作全部 `ctx` 能力。`StepContext` 仍然提供完整能力，主要供：

1. `commit`、`validate`、`state`、`mapResponse` 等回调使用。
2. `defineInteractionStep` 的 reducer 使用。
3. `defineRawStep` 的 escape hatch 使用。
4. 框架内部 Step Runtime 使用。

```ts
export interface StepContext {
  flow: FlowRuntimeApi;
  scope: StepScope;
  events: ScopedEventApi;
  commands: TypedCommandBus<KioskCommands>;
  queries: TypedQueryBus<KioskQueries>;

  ui: UiPort<any>;
  devices: DeviceManager;
  host: HostGateway;
  timeout: TimeoutService;
  logger: Logger;
  journal: ElectronicJournal;
  audit: InteractionAuditService;
  tts: TtsService;
  voiceGuide: VoiceGuideService;
  recovery: RecoveryManager;
  transaction: TransactionContext;
  config: ConfigService;
  locale: LocaleService;
  resources: TransactionResourceRegistry;
  redact: RedactionService;

  next(edgeName?: string, data?: unknown): StepResult;
  end(endName: string, data?: unknown): StepResult;
}
```

### 13.1 Standard Step 回调中的 ctx 使用边界

标准 Step Builder 的回调应尽量保持业务语义清晰。

推荐：

```ts
commit(ctx, accountNo) {
  ctx.transaction.set("accountNo", accountNo);
}
```

```ts
validate(value) {
  if (value.length < 6) return { ok: false, error: "Too short" };
  return { ok: true, value };
}
```

不推荐在 `validate` / `commit` 中启动硬件、订阅事件、手动创建 timeout。此类逻辑应封装成 `InputSource`、`Policy` 或 `defineInteractionStep`。

### 13.2 InteractionStep 专用上下文

Reducer 风格 Step 需要返回状态变化或完成结果。

```ts
export interface InteractionReduceContext<TAccepted> extends StepContext {
  accept(value: TAccepted): InteractionReduceResult<TAccepted>;
  cancel(data?: unknown): InteractionReduceResult<TAccepted>;
  timeout(data?: unknown): InteractionReduceResult<TAccepted>;
  fail(error: unknown): InteractionReduceResult<TAccepted>;
}

export type InteractionReduceResult<TAccepted> =
  | { type: "state"; state: unknown }
  | { type: "accepted"; value: TAccepted }
  | { type: "cancelled"; data?: unknown }
  | { type: "timeout"; data?: unknown }
  | { type: "failed"; error: unknown };
```

## 14. StepScope

### 14.1 目标

StepScope 解决这些问题：

1. Step 结束后事件 handler 自动取消。
2. Step 结束后 timeout 自动取消。
3. Step 结束后硬件 pending operation 自动 cancel。
4. Step 结束后遗留 Promise 不能再更新 UI 或影响流程。
5. 复杂 Step 可以安全地 race 多个输入源。

### 14.2 接口

```ts
export interface StepScope {
  readonly signal: AbortSignal;
  readonly disposed: boolean;

  onDispose(cleanup: () => void | Promise<void>): void;

  dispose(reason?: string): Promise<void>;

  guard<T>(promise: Promise<T>): Promise<T>;

  task<T>(
    factory: (signal: AbortSignal) => Promise<T>,
    options?: ScopedTaskOptions
  ): ScopedTask<T>;

  waitEvent<K extends keyof KioskEvents>(
    eventName: K,
    filter?: (event: KioskEvents[K]) => boolean
  ): Promise<KioskEvents[K]>;

  race<T extends Record<string, Promise<unknown>>>(
    tasks: T
  ): Promise<ScopedRaceResult<T>>;
}

export interface ScopedTask<T> {
  readonly promise: Promise<T>;
  cancel(reason?: string): Promise<void>;
}

export interface ScopedTaskOptions {
  onCancel?: () => void | Promise<void>;
  label?: string;
}
```

### 14.3 Promise Guard 规则

框架应提供 `scope.guard()`。

```ts
const result = await ctx.scope.guard(fetchSomething());
```

如果 Step 已结束，`guard()` 不允许结果继续向下执行。推荐实现为：

- 如果 scope 未 dispose，正常返回。
- 如果 scope 已 dispose，抛出 `ScopeDisposedError`。
- FlowEngine 捕获 `ScopeDisposedError` 时视为 Step 已经结束，不记录为业务错误。

### 14.4 禁止裸 Promise 回调

业务规范：Step 内部不允许写裸 `.then()` 修改 UI 或流程。

不推荐：

```ts
fetch("/a").then(result => {
  ctx.ui.patch("some.screen", result);
});
```

推荐：

```ts
const task = ctx.scope.task(signal => fetch("/a", { signal }));
const result = await task.promise;
await ctx.ui.patch("some.screen", result);
```

对于不支持 AbortSignal 的 Native Promise，至少要保证：

```txt
底层操作可能无法真正取消，但 Step 结束后结果会被忽略。
```

---

## 15. Timeout Service

### 15.1 TimeoutPolicy

```ts
export type TimeoutPolicy =
  | {
      type: "endTransaction";
      reason: "timeout";
    }
  | {
      type: "askMoreTime";
      dialog: string;
      extendMs: number;
      maxExtendCount?: number;
    }
  | {
      type: "custom";
      handler: string;
    };
```

### 15.2 TimeoutService

```ts
export interface TimeoutService {
  create(options: CreateTimeoutOptions): StepTimeout;
}

export interface CreateTimeoutOptions {
  name: string;
  durationMs: number;
  policy: TimeoutPolicy;
  scope?: StepScope;
}

export interface StepTimeout {
  wait(): Promise<TimeoutWaitResult>;
  reset(): void;
  cancel(): void;
}

export type TimeoutWaitResult =
  | { type: "continue" }
  | { type: "expired" }
  | { type: "cancelled" };
```

### 15.3 More Time 行为

欧美客户常见规则：超时后弹出 Dialog 询问是否需要更多时间。

流程：

1. Step timeout 到期。
2. TimeoutService 调用 `ui.openDialog("dialog.moreTime", ...)`。
3. 用户选择 Yes：返回 `{ type: "continue" }`，Step reset timeout。
4. 用户选择 No 或 Dialog 超时：返回 `{ type: "expired" }`。
5. 达到最大延长次数：返回 `{ type: "expired" }`。

其他客户可以配置为直接结束交易。

---

## 16. Host Gateway

### 16.1 分层

```txt
Business Flow
  -> HostGateway canonical API
    -> Message Mapper
      -> Codec
        -> Transport
```

### 16.2 Transport

```ts
export interface HostTransport {
  connect(): Promise<void>;
  send(data: Uint8Array | string): Promise<void>;
  onData(handler: (data: Uint8Array | string) => void): Disposable;
  close(): Promise<void>;
}
```

实现示例：

```txt
HttpJsonTransport
TcpTransport
WebSocketTransport
NativeBridgeTransport
```

### 16.3 Codec

```ts
export interface HostCodec<RawMessage> {
  encode(message: RawMessage): Uint8Array | string;
  decode(data: Uint8Array | string): RawMessage;
}
```

实现示例：

```txt
JsonCodec
Iso8583Codec
CustomBinaryCodec
```

### 16.4 MessageMapper

```ts
export interface HostMessageMapper<RawMessage> {
  toCanonical(raw: RawMessage): CanonicalHostMessage;
  fromCanonical(message: CanonicalHostMessage): RawMessage;
}
```

Canonical message：

```ts
export type CanonicalHostMessage =
  | {
      type: "command";
      command: HostCommand;
      traceId: string;
    }
  | {
      type: "response";
      requestId: string;
      status: "approved" | "declined" | "error";
      body: unknown;
    }
  | {
      type: "notification";
      name: string;
      body: unknown;
    };
```

### 16.5 HostGateway

```ts
export interface HostGateway {
  send<TReq = unknown, TRes = unknown>(
    messageType: string,
    body: TReq,
    options?: HostSendOptions
  ): Promise<HostResponse<TRes>>;

  request<TReq = unknown, TRes = unknown>(
    request: HostRequest<TReq>,
    options?: HostSendOptions
  ): Promise<HostResponse<TRes>>;
}

export interface HostSendOptions {
  timeoutMs?: number;
  traceId?: string;
  signal?: AbortSignal;
}
```

业务只调用 HostGateway，不关心底层是 HTTP JSON 还是 TCP ISO8583。

---

## 17. Operational State

框架应区分服务状态和交易状态。

### 17.1 ServiceState

```ts
export type ServiceState =
  | "booting"
  | "inService"
  | "outOfService"
  | "suspendedByHost"
  | "maintenance"
  | "shuttingDown";
```

### 17.2 TransactionState

```ts
export type TransactionState =
  | "idle"
  | "starting"
  | "inTransaction"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled";
```

### 17.3 HostCommand

```ts
export type HostCommand =
  | {
      type: "suspendService";
      mode: "immediate" | "afterCurrentTransaction";
      reason?: string;
    }
  | {
      type: "resumeService";
    }
  | {
      type: "enterMaintenance";
      reason?: string;
    }
  | {
      type: "exitMaintenance";
    };
```

Host command 原始格式由客户 Host Plugin 转换成统一 `HostCommand`。

---

## 18. 多窗口与 Supervisor

### 18.1 WindowManagerPort

```ts
export interface WindowManagerPort {
  openWindow(options: OpenWindowOptions): Promise<WindowRef>;
  closeWindow(windowId: string): Promise<void>;
  sendToWindow<T>(windowId: string, message: T): Promise<void>;
  broadcast<T>(message: T): Promise<void>;
}

export interface OpenWindowOptions {
  role: RuntimeRole;
  url?: string;
  title?: string;
  width?: number;
  height?: number;
  fullscreen?: boolean;
  metadata?: Record<string, unknown>;
}

export interface WindowRef {
  id: string;
  role: RuntimeRole;
}
```

### 18.2 多窗口通信

窗口间通信不应该直接互相调用函数，而应通过事件和命令转发。

示例：

```ts
await ctx.events.publish("window.message.received", {
  fromWindowId,
  toWindowId,
  message,
});
```

Supervisor 可以查看状态、发送维护命令、关闭窗口、切换 OutOfService 等。

---

## 19. Logging / Electronic Journal / Interaction Audit

### 19.1 目标

所有客户选择必须记录到 Log 和 EJ，包括：

1. 触摸屏 Button。
2. Pinpad Key。
3. Cancel。
4. More Time Yes / No。
5. 关键交易选择。

### 19.2 Logger

```ts
export interface Logger {
  debug(event: string, payload?: unknown): Promise<void>;
  info(event: string, payload?: unknown): Promise<void>;
  warn(event: string, payload?: unknown): Promise<void>;
  error(event: string, payload?: unknown): Promise<void>;
}
```

### 19.3 ElectronicJournal

```ts
export interface ElectronicJournal {
  write(entry: JournalEntry): Promise<void>;
}

export interface JournalEntry {
  type: string;
  timestamp?: number;
  transactionId?: string;
  data?: unknown;
}
```

### 19.4 InteractionAuditService

```ts
export interface InteractionAuditService {
  beginPrompt(prompt: AuditPrompt): Promise<void>;
  recordCustomerChoice(choice: AuditChoice): Promise<void>;
  recordCustomerInput(input: AuditInput): Promise<void>;
  endPrompt(promptId: string): Promise<void>;
}
```

UI Adapter 应统一发布：

```ts
"ui.action.performed"
```

Pinpad Plugin 应统一发布：

```ts
"device.pinpad.keyPressed"
```

InteractionAuditPlugin 订阅这些事件，自动写 Log 和 EJ。

### 19.5 脱敏规则

必须支持 RedactionPolicy：

```ts
export interface RedactionService {
  redact(eventName: string, payload: unknown): unknown;
  pinpadKey(key: PinpadKey): string;
  accountNo(value: string): string;
  cardNo(value: string): string;
  barcode(value: string): string;
}
```

强制规则：

1. PIN 不记录明文。
2. 密码不记录明文。
3. 账号、卡号、证件号必须 mask。
4. QR / Barcode 内容按业务策略决定是否可记录。

---

## 20. TTS Service

```ts
export interface TtsService {
  speak(text: string, options?: TtsOptions): Promise<void>;
  stop(): Promise<void>;
  isSpeaking(): Promise<boolean>;
}

export interface TtsOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}
```

默认实现：

```txt
BrowserSpeechSynthesisTtsService
```

可替换实现：

```txt
NativeTtsService
VendorTtsService
NoopTtsService
```

---

## 21. Voice Guide Service

Voice Guide 用于播放预录音频，与 TTS 分离。

### 21.1 目录结构

```txt
assets/
  audios/
    zh/
      idle.welcome.mp3
      account.input.mp3
      card.take.mp3
    en/
      idle.welcome.mp3
      account.input.mp3
      card.take.mp3
```

### 21.2 接口

```ts
export interface VoiceGuideService {
  play(key: string, options?: VoiceGuideOptions): Promise<void>;
  stop(): Promise<void>;
}

export interface VoiceGuideOptions {
  lang?: string;
  fallbackLang?: string;
  interrupt?: "replace" | "queue" | "ignoreIfPlaying";
}
```

资源解析规则：

```txt
assets/audios/{lang}/{key}.mp3
```

---

## 22. RecoveryManager

### 22.1 目标

任意交易步骤出现未处理错误都不应卡住。系统必须尽力恢复客户介质并回到安全状态。

### 22.2 Recovery 流程

当 FlowEngine 捕获未处理错误时：

1. 停止当前 StepScope。
2. 停止所有 Timeout。
3. 取消所有硬件 pending operation。
4. UI 切到 recovering / please wait。
5. 根据资源状态 eject / retract / retain。
6. 写 Log。
7. 写 EJ。
8. 清理 TransactionContext。
9. 回到 idle 或 outOfService。

### 22.3 TransactionResourceRegistry

```ts
export interface TransactionResourceRegistry {
  register(name: string, resource: TransactionResource): Disposable;
  recover(reason: RecoveryReason): Promise<void>;
  clear(): Promise<void>;
}

export interface TransactionResource {
  onNormalEnd?: () => Promise<void>;
  onCancel?: () => Promise<void>;
  onTimeout?: () => Promise<void>;
  onError?: () => Promise<void>;
  onDeviceFailure?: () => Promise<void>;
}

export type RecoveryReason =
  | "normalEnd"
  | "cancel"
  | "timeout"
  | "unhandledError"
  | "deviceFailure";
```

示例：

```ts
ctx.resources.register("card", {
  onNormalEnd: async () => ctx.devices.cardReader.eject(),
  onCancel: async () => ctx.devices.cardReader.eject(),
  onTimeout: async () => ctx.devices.cardReader.eject(),
  onError: async () => ctx.devices.cardReader.eject(),
  onDeviceFailure: async () => ctx.devices.cardReader.retain("device failure"),
});
```

---

## 23. Config 系统

### 23.1 Layered Config

配置按层叠加：

```txt
core defaults
  -> market defaults
    -> customer config
      -> site config
        -> terminal config
          -> runtime override from host command
```

### 23.2 ConfigService

```ts
export interface ConfigService {
  get<T>(path: string, defaultValue?: T): T;
  setRuntimeOverride(path: string, value: unknown): void;
  watch<T>(path: string, handler: (value: T) => void): Disposable;
}
```

### 23.3 Schema Validation

推荐使用 schema 验证配置。实现可选用 Zod 或框架自定义 schema。

```ts
const AccountInputConfig = z.object({
  minLength: z.number().default(6),
  maxLength: z.number().default(18),
  timeoutMs: z.number().default(90_000),
  timeoutPolicy: z.enum(["endTransaction", "askMoreTime"]),
});
```

---

## 24. 典型 Step 示例：账号输入（V2 Step Kit）

### 24.1 需求

账号输入步骤需要：

1. 显示账号输入页面。
2. 允许 Pinpad 输入。
3. 允许 Barcode Reader 扫码。
4. 数字键更新 UI。
5. Clear / Backspace / Enter / Cancel 处理。
6. 输入长度错误时更新 UI 并继续等待。
7. Timeout 支持 More Time。
8. Step 结束后自动 cancel 硬件。
9. 客户输入自动写 Log 和 Electronic Journal。

V2 不推荐业务开发者直接写 `while + race`。下面按推荐顺序给出三种写法。

### 24.2 推荐写法一：Recipe

适合客户差异较少、符合框架默认账号输入规则的场景。

```ts
export const inputAccountStep = Recipes.inputAccount({
  id: "inputAccount",
  screen: "account.input",
  saveAs: "accountNo",

  constraints: {
    minLength: 6,
    maxLength: 18,
  },

  timeout: {
    key: "accountInput",
    durationMs: 90_000,
    policy: "askMoreTime",
  },

  sources: {
    pinpad: true,
    barcodeQr: {
      parse: parseAccountFromQrCode,
    },
    uiActions: true,
  },

  routes: {
    valid: "AccountInquiry",
    cancel: "Cancelled",
    timeout: "Timeout",
    failed: "Failed",
  },
});
```

业务开发者只需要知道：

```txt
输入什么 -> accountNo
在哪里显示 -> account.input
从哪里输入 -> pinpad + barcode + ui
怎么校验 -> min/max + parse
成功走哪条边 -> AccountInquiry
```

### 24.3 推荐写法二：defineTextInputStep

适合需要自定义校验、提交逻辑、输入源配置的场景。

```ts
export const inputAccountStep = defineTextInputStep({
  id: "inputAccount",

  screen: "account.input",
  voiceGuide: "account.input",

  timeout: {
    key: "accountInput",
    durationMs: 90_000,
    policy: {
      type: "askMoreTime",
      dialog: "dialog.moreTime",
      extendMs: 90_000,
      maxExtendCount: 3,
    },
  },

  audit: "customerInput",
  cancelRoute: "Cancelled",

  value: {
    minLength: 6,
    maxLength: 18,
    mask: false,
    redactAs: "accountNo",
  },

  sources: [
    InputSources.pinpad.numeric({
      enter: "submit",
      cancel: "cancel",
      clear: "clear",
      backspace: "backspace",
    }),

    InputSources.barcode.qr({
      parse(text) {
        const result = parseAccountFromQrCode(text);

        if (!result.ok) {
          return {
            ok: false,
            error: "Invalid QR code",
          };
        }

        return {
          ok: true,
          value: result.accountNo,
          autoSubmit: true,
        };
      },
    }),

    InputSources.ui.action({
      submit: "submit",
      cancel: "cancel",
    }),
  ],

  validate(value) {
    if (value.length < 6) {
      return {
        ok: false,
        error: "Account number is too short",
      };
    }

    return {
      ok: true,
      value,
    };
  },

  async commit(ctx, accountNo) {
    ctx.transaction.set("accountNo", accountNo);
  },

  routes: {
    accepted: "Valid",
    cancelled: "Cancelled",
    timeout: "Timeout",
    failed: "Failed",
  },
});
```

框架内部自动处理：

```txt
ui.show("account.input")
voiceGuide.play("account.input")
pinpad.startKeyMode()
barcodeReader.read()
ui.waitAction()
timeout.start()
more time dialog
customer input audit
EJ write
timeout reset
pinpad.cancel()
barcodeReader.cancel()
scope.dispose()
stale promise guard
```

### 24.4 复杂写法：defineInteractionStep

当账号输入步骤有更多状态，例如手动输入 / 扫码模式切换、动态禁用扫码、多阶段校验，可以使用 reducer 风格。

```ts
export const inputAccountStep = defineInteractionStep({
  id: "inputAccount",

  initialState() {
    return {
      mode: "manual" as "manual" | "scan",
      value: "",
      error: undefined as string | undefined,
      scanEnabled: true,
    };
  },

  render(state) {
    return {
      screen: "account.input",
      state: {
        mode: state.mode,
        value: state.value,
        error: state.error,
        scanEnabled: state.scanEnabled,
      },
    };
  },

  sources(state) {
    return [
      InputSources.pinpad.numeric(),
      state.scanEnabled ? InputSources.barcode.qr() : InputSources.none(),
      InputSources.ui.action(),
    ];
  },

  timeout: {
    key: "accountInput",
    durationMs: 90_000,
    policy: "askMoreTime",
  },

  reduce(state, intent, ctx) {
    if (intent.type === "append") {
      if (state.value.length >= 18) return state;
      return {
        ...state,
        value: state.value + intent.text,
        error: undefined,
      };
    }

    if (intent.type === "backspace") {
      return {
        ...state,
        value: state.value.slice(0, -1),
        error: undefined,
      };
    }

    if (intent.type === "clear") {
      return {
        ...state,
        value: "",
        error: undefined,
      };
    }

    if (intent.type === "scan") {
      const parsed = parseAccountFromQrCode(intent.text);

      if (!parsed.ok) {
        return {
          ...state,
          error: "Invalid QR code",
        };
      }

      return ctx.accept(parsed.accountNo);
    }

    if (intent.type === "submit") {
      if (state.value.length < 6) {
        return {
          ...state,
          error: "Account number is too short",
        };
      }

      return ctx.accept(state.value);
    }

    if (intent.type === "cancel") {
      return ctx.cancel();
    }

    return state;
  },

  commit(ctx, accountNo) {
    ctx.transaction.set("accountNo", accountNo);
  },

  routes: {
    accepted: "Valid",
    cancelled: "Cancelled",
    timeout: "Timeout",
    failed: "Failed",
  },
});
```

### 24.5 Escape hatch：defineRawStep

只有在标准 Step Kit 和 InteractionStep 都无法表达时，才使用 raw step。

```ts
export const inputAccountStep = defineRawStep("inputAccount", async ctx => {
  // 可以直接使用 ctx.scope.race / ctx.events / ctx.devices。
  // 该方式能力最大，但使用者心智负担最高，不推荐作为普通业务默认写法。
  return ctx.next("Valid");
});
```

文档和代码 review 应明确：

```txt
业务项目中出现 defineRawStep 时，需要说明为什么标准 Step Kit 不够用。
```

## 25. Testing Kit

### 25.1 目标

业务流程必须可以在没有 UI、没有真实硬件、没有真实 Host 的情况下测试。

测试组件：

```txt
HeadlessUiAdapter
FakePinpad
FakeBarcodeReader
FakeCardReader
FakeHostGateway
VirtualClock
InMemoryLogger
InMemoryElectronicJournal
FlowTestRunner
EventTraceRecorder
```

### 25.2 示例测试

```ts
test("account input via pinpad success", async () => {
  const app = createTestKioskApp({
    ui: new HeadlessUiAdapter<AppScreens>(),
    devices: createFakeDevices(),
    host: createFakeHost(),
    clock: new VirtualClock(),
  });

  const run = app.flow.run("accountInput");

  app.devices.pinpad.press("1");
  app.devices.pinpad.press("2");
  app.devices.pinpad.press("3");
  app.devices.pinpad.press("4");
  app.devices.pinpad.press("5");
  app.devices.pinpad.press("6");
  app.devices.pinpad.press("enter");

  const result = await run;

  expect(result.endName).toBe("Valid");
  expect(app.transaction.get("accountNo")).toBe("123456");
});
```

### 25.3 Timeout 测试

```ts
test("account input timeout asks more time", async () => {
  const app = createTestKioskApp({
    clock: new VirtualClock(),
  });

  const run = app.flow.run("accountInput");

  app.clock.advanceBy(90_000);

  expect(app.ui.currentDialog()).toBe("dialog.moreTime");

  app.ui.click("dialog.moreTime", { type: "yes" });

  app.clock.advanceBy(60_000);

  expect(app.ui.currentScreen()).toBe("account.input");

  await run.cancel();
});
```

---

## 26. MVP 实现顺序

建议按以下里程碑实现，避免一开始范围过大。V2 的实现顺序相比初版增加了 Step Kit / InteractionRuntime，目的是尽早验证“低心智负担”的核心体验。

### Milestone 1: Core Runtime

必须实现：

1. `createServiceToken`
2. `ServiceRegistry`
3. `TypedEventBus`
4. `TypedCommandBus`
5. `TypedQueryBus`
6. `PluginRuntime`
7. `LifecycleRegistry`
8. `Logger` 抽象
9. 基础单元测试

验收标准：

- Plugin 可以注册 Service / Event / Command / Query。
- 重复 Plugin ID 会启动失败。
- 重复 Command handler 会启动失败。
- 缺失依赖会启动失败。
- EventBus 支持 publish / subscribe / wait。

### Milestone 2: UI Abstraction

必须实现：

1. `ScreenMap`
2. `UiPort`
3. `HeadlessUiAdapter`
4. 基础 React adapter skeleton
5. UI action event

验收标准：

- Step 可调用 `ui.show` / `ui.patch`。
- 测试中可检查 UI history。
- `ui.waitAction` 可被测试代码触发。

### Milestone 3: Flow Engine Core

必须实现：

1. FlowDefinition 类型。
2. FlowCompiler。
3. start / action / end。
4. subflow。
5. shortcut compile-time folding。
6. StepRegistry。
7. StepContext。
8. StepScope。
9. scoped event wait。
10. scoped race。
11. `defineRawStep`。

验收标准：

- 能执行简单 Flow。
- Action 返回 `next("A")` 可走到对应 edge。
- Action 返回 `end("Success")` 可结束 Flow。
- Subflow endName 可映射到父 Flow edge。
- Step 结束后事件订阅被清理。

### Milestone 4: Timeout / Cancellation

必须实现：

1. TimeoutService。
2. VirtualClock。
3. More Time policy。
4. Scope dispose 自动取消 timeout。
5. Scope guard。

验收标准：

- Timeout 到期可返回 expired。
- More Time Yes 可返回 continue。
- Step 结束后 timeout 不再触发。
- 已结束 Step 的 Promise 不可更新 UI。

### Milestone 5: InteractionRuntime / InputSource

必须实现：

1. `InteractionIntent`。
2. `InputSource` 接口。
3. `InputSources.ui.action()`。
4. `InputSources.pinpad.numeric()`。
5. `InputSources.barcode.qr()`。
6. `InteractionRuntime` 基础循环。
7. source start / stop 生命周期。
8. intent audit hook。
9. intent 后 timeout reset。

验收标准：

- 一个 InteractionRuntime 可以同时监听 UI action、Pinpad、Barcode。
- 任一 source 产生 intent 后可驱动状态变化。
- Step 结束后所有 source 自动 stop。
- Step 结束后 pinpad.cancel / barcode.cancel 被调用。
- intent 会触发 audit hook，且可脱敏。

### Milestone 6: Standard Step Kit

必须实现：

1. `defineTextInputStep`。
2. `defineChoiceStep`。
3. `defineConfirmStep`。
4. `defineHostRequestStep` skeleton。
5. `defineWaitDeviceStep` skeleton。
6. Step policy 基础能力：voiceGuide、timeout、audit、cancel、autoCleanup。

验收标准：

- 使用 `defineTextInputStep` 可以完成账号输入场景。
- 使用 `defineChoiceStep` 可以完成账户类型选择场景。
- 不需要业务代码手写 `ctx.scope.race`。
- timeout、cancel、audit、UI patch 自动工作。

### Milestone 7: Device / Recovery

必须实现：

1. DeviceManager 接口。
2. Fake devices。
3. Native device skeleton。
4. Resource registry。
5. RecoveryManager。

验收标准：

- Step 结束后自动调用 pinpad.cancel / barcode.cancel。
- 未处理异常触发 RecoveryManager。
- Recovery 后 TransactionContext 清理并回到 idle。

### Milestone 8: Host Gateway

必须实现：

1. HostTransport。
2. HostCodec。
3. HostMessageMapper。
4. HostGateway。
5. FakeHostGateway。

验收标准：

- 业务可调用 `host.send("accountInquiry", data)`。
- 客户 Plugin 可替换 Codec / Mapper。
- Host command 可转换成内部 `HostCommand`。

### Milestone 9: Logging / EJ / Audit

必须实现：

1. Logger。
2. ElectronicJournal。
3. InteractionAuditService。
4. RedactionService。
5. UI action audit。
6. Pinpad key audit。
7. Standard Step Kit 的默认 audit 集成。

验收标准：

- UI button action 自动写 Log 和 EJ。
- Pinpad key 自动写 Log 和 EJ。
- TextInputStep 中的输入自动按 `redactAs` 脱敏。
- PIN / password 不写明文。

### Milestone 10: Recipes / TTS / Voice Guide / Window Manager

必须实现：

1. `Recipes.inputAccount`。
2. `Recipes.waitCardInserted`。
3. `Recipes.ejectCard`。
4. TtsService。
5. Browser TTS。
6. VoiceGuideService。
7. audio asset resolver。
8. WindowManagerPort。
9. Headless / Native window skeleton。

验收标准：

- 业务可用 Recipe 拼出一个基本交易流程。
- Step 可调用 `tts.speak`。
- Step 可调用 `voiceGuide.play("account.input")`。
- Supervisor window 可通过 WindowManagerPort 打开。

## 27. Codex 编码任务建议

使用 Codex 或其他 Coding Agent 时，建议按下面方式拆任务，不要一次性要求实现所有模块。

### Task 1: 初始化 Monorepo

要求：

1. 使用 TypeScript。
2. 使用 pnpm workspace。
3. 使用 Vitest。
4. 创建 packages/core、packages/flow、packages/ui、packages/testing-kit。
5. 配置 tsconfig base。
6. 每个 package 有独立 package.json。

### Task 2: 实现 packages/core

实现：

```txt
service-registry
event-bus
command-bus
query-bus
plugin-runtime
lifecycle
errors
logger abstraction
```

测试：

```txt
service registry duplicate provider test
event bus publish/subscribe test
event bus wait test
command bus single handler test
plugin dependency validation test
```

### Task 3: 实现 packages/ui

实现：

```txt
ScreenMap
UiPort
HeadlessUiAdapter
UiActionEmitter
```

测试：

```txt
show records history
patch records history
waitAction resolves when action emitted
```

### Task 4: 实现 packages/flow StepScope

实现：

```txt
StepScopeImpl
scope.task
scope.guard
scope.waitEvent
scope.race
ScopeDisposedError
```

测试：

```txt
dispose calls cleanups
dispose aborts signal
waitEvent unsubscribes after dispose
guard rejects after dispose
race returns first resolved result
```

### Task 5: 实现 FlowCompiler 和 FlowEngine Core

实现：

```txt
FlowDefinition
FlowCompiler
StepRegistry
FlowEngine
start/action/end/subflow/shortcut
defineRawStep
```

测试：

```txt
compile fails without start
compile fails with duplicate end name
compile folds shortcut
run simple flow success
run subflow maps endName
raw step can return next/end
```

### Task 6: 实现 TimeoutService 和 VirtualClock

实现：

```txt
Clock abstraction
SystemClock
VirtualClock
TimeoutService
MoreTimeTimeoutPolicy
```

测试：

```txt
timeout expires
reset restarts timer
cancel prevents timeout
more time yes continues
more time no expires
```

### Task 7: 实现 InteractionIntent 和 InputSource

实现：

```txt
InteractionIntent
InputSource
InputSourceContext
InputSources.ui.action
InputSources.pinpad.numeric
InputSources.barcode.qr
InputSources.none
```

测试：

```txt
pinpad numeric maps digit to append
pinpad enter maps to submit
pinpad cancel maps to cancel
ui action maps to action/submit/cancel
barcode result maps to scan
source stop is called on dispose
```

### Task 8: 实现 InteractionRuntime

实现：

```txt
InteractionRuntime
startSources
stopSources
intent loop
render state to UI
patch UI after state change
timeout integration
more time integration
audit hook
cancel handling
```

测试：

```txt
runtime starts all sources
first source intent updates state
append intent patches UI
submit intent resolves accepted
cancel intent resolves cancelled
timeout resolves timeout
runtime disposes sources after finish
```

### Task 9: 实现 defineTextInputStep

实现：

```txt
TextInputStepDefinition
defineTextInputStep
text input reducer default behavior
validate integration
commit integration
route mapping
```

测试：

```txt
pinpad account input success
short account shows error and continues
clear resets value
backspace removes char
barcode parse success auto submits
barcode parse failure shows error and continues
cancel returns Cancelled
timeout returns Timeout
```

### Task 10: 实现 defineChoiceStep / defineConfirmStep

实现：

```txt
ChoiceStepDefinition
defineChoiceStep
ConfirmStepDefinition
defineConfirmStep
pinpad function key mapping
ui choice mapping
```

测试：

```txt
ui choice routes to choice.route
pinpad function key selects choice
confirm routes confirmed
cancel routes cancelled
timeout routes timeout
```

### Task 11: 实现 Device / Testing Kit

实现：

```txt
createTestKioskApp
FakePinpad
FakeBarcodeReader
FakeHostGateway
InMemoryLogger
InMemoryElectronicJournal
```

测试：

```txt
fake pinpad emits typed event
fake barcode resolves read
fake host records sent messages
TextInputStep works in headless test app
```

### Task 12: 实现 HostRequestStep / WaitDeviceStep skeleton

实现：

```txt
defineHostRequestStep
defineWaitDeviceStep
loading screen
host timeout
response route mapping
device wait route mapping
```

测试：

```txt
host approved routes Approved
host declined routes Declined
host timeout routes HostTimeout
wait device done routes done
wait device error routes deviceError
```

### Task 13: 实现 Recipes

实现：

```txt
Recipes.inputAccount
Recipes.waitCardInserted
Recipes.ejectCard
```

测试：

```txt
inputAccount expands to TextInputStep
waitCardInserted expands to WaitDeviceStep
ejectCard expands to MediaRecovery/WaitDevice behavior
```

### Task 14: 实现示例 Flow

创建 `examples/atm-basic`：

```txt
idle flow
account input step using Recipe
account inquiry host step
success end
cancel end
timeout end
```

测试：

```txt
pinpad account input success
cancel returns Cancelled
timeout returns Timeout
barcode account input success
host approved reaches success
```

## 28. 最低代码质量要求

### 28.1 TypeScript

1. 开启 `strict: true`。
2. 禁止 `any`，除非在边界层有明确原因。
3. 所有 public API 必须导出类型。
4. 错误必须使用框架错误类型包装。
5. 不要在业务层暴露 NativeBridge command 字符串。

### 28.2 测试

1. 每个 package 必须有单元测试。
2. FlowEngine 必须覆盖正常、取消、超时、错误、subflow。
3. StepScope 必须重点测试 dispose 后行为。
4. Testing Kit 必须支持无 UI、无硬件、无 Host 测试。

### 28.3 日志与安全

1. PIN、密码不得写入日志。
2. 账号、卡号、证件号必须脱敏。
3. 所有客户选择必须可追溯到 Log 和 EJ。
4. Recovery 必须写 Log 和 EJ。

---

## 29. 初始 API 导出建议

### @kiosk/core

```ts
export * from "./event-bus";
export * from "./command-bus";
export * from "./query-bus";
export * from "./service-registry";
export * from "./plugin";
export * from "./lifecycle";
export * from "./config";
export * from "./logging";
export * from "./errors";
```

### @kiosk/flow

```ts
export * from "./graph";
export * from "./compiler";
export * from "./engine";
export * from "./step";
export * from "./scope";
export * from "./testing";
```

### @kiosk/ui

```ts
export * from "./screen-contract";
export * from "./ui-port";
export * from "./headless";
```

### @kiosk/testing-kit

```ts
export * from "./create-test-kiosk-app";
export * from "./fake-devices";
export * from "./fake-host";
export * from "./headless-ui";
export * from "./virtual-clock";
```

---

## 30. 关键风险与处理策略

### 30.1 过度抽象

风险：一开始设计过多接口，导致编码慢。

处理：严格按 MVP 里程碑实现，每个里程碑必须有测试和可运行示例。

### 30.2 FlowEngine 变成复杂 DSL

风险：把所有逻辑放进 JSON，最终难以维护。

处理：Flow JSON 只负责结构，复杂逻辑放到 TypeScript Step Function。

### 30.3 Promise 无法真正取消

风险：部分 Native API 或第三方 Promise 不支持 AbortSignal。

处理：StepScope 必须保证逻辑取消，即 Step 结束后结果被忽略。底层是否物理取消由 adapter 尽力实现。

### 30.4 日志泄露敏感信息

风险：业务开发者不小心记录 PIN、账号、卡号。

处理：InteractionAuditPlugin 和 Logger middleware 默认走 RedactionService。敏感字段默认脱敏。

### 30.5 多窗口状态不一致

风险：主窗口、Supervisor 窗口状态不同步。

处理：状态变更统一通过 EventBus / CommandBus，并由 WindowManagerPlugin 负责跨窗口转发。

---

## 31. 推荐第一批要实现的文件

Codex 可以优先创建以下文件：

```txt
packages/core/src/service-registry/service-token.ts
packages/core/src/service-registry/service-registry.ts
packages/core/src/event-bus/event-bus.ts
packages/core/src/command-bus/command-bus.ts
packages/core/src/query-bus/query-bus.ts
packages/core/src/plugin/plugin.ts
packages/core/src/plugin/plugin-runtime.ts
packages/core/src/lifecycle/lifecycle-registry.ts
packages/core/src/errors/kiosk-error.ts
packages/core/src/index.ts

packages/ui/src/screen-contract/screen-map.ts
packages/ui/src/ui-port/ui-port.ts
packages/ui/src/headless/headless-ui-adapter.ts
packages/ui/src/index.ts

packages/flow/src/graph/flow-definition.ts
packages/flow/src/compiler/flow-compiler.ts
packages/flow/src/scope/step-scope.ts
packages/flow/src/step/step-context.ts
packages/flow/src/step/step-registry.ts
packages/flow/src/engine/flow-engine.ts
packages/flow/src/index.ts

packages/testing-kit/src/virtual-clock/virtual-clock.ts
packages/testing-kit/src/fake-devices/fake-pinpad.ts
packages/testing-kit/src/create-test-kiosk-app.ts
packages/testing-kit/src/index.ts
```

---

## 32. 完成 MVP 后的示例使用方式

```ts
const app = createTestKioskApp({
  screens: {} as AppScreens,
  flows: [accountInputFlow],
  steps: {
    "account.input": inputAccountStep,
  },
});

const run = app.flow.run("accountInput");

app.devices.pinpad.press("1");
app.devices.pinpad.press("2");
app.devices.pinpad.press("3");
app.devices.pinpad.press("4");
app.devices.pinpad.press("5");
app.devices.pinpad.press("6");
app.devices.pinpad.press("enter");

const result = await run;

expect(result.endName).toBe("Valid");
```

---

## 33. 结论

本框架应以 `Core Runtime + Plugin System + FlowEngine + StepScope` 为核心。

最关键的技术决策是：

```txt
业务复杂性不压进 Flow JSON；
Flow JSON 只描述路径；
复杂业务步骤使用 TypeScript Step Function；
StepScope 统一处理取消、清理、超时、事件订阅和 Promise 生命周期。
```

这样可以同时满足：

1. UI 可替换。
2. Container 可替换。
3. Host 协议可替换。
4. 硬件供应商可替换。
5. 客户差异可配置和可插件化。
6. 复杂交易步骤可维护。
7. 无 UI 自动化测试可执行。
8. 出错后可恢复到安全状态。

