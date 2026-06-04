import type {
  Disposable,
  KioskCommands,
  KioskEvents,
  KioskQueries,
  TypedCommandBus,
  TypedEventBus,
  TypedQueryBus,
} from "./bus";
import type {
  ElectronicJournal,
  InteractionAuditService,
  Logger,
  RedactionService,
} from "./observability";
import type { TimeoutService } from "./timeout";
import type { UiPort } from "./ui";
import type { DeviceManager } from "./native";
import type { RecoveryManager, TransactionResourceRegistry } from "./recovery";
import type { HostGateway } from "./host";

export interface FlowDefinition {
  id: string;
  version: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type FlowNode = StartNode | EndNode | ActionNode | SubflowNode | ShortcutNode;

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
  exits?: Record<string, string>;
}

export interface ShortcutNode extends BaseNode {
  type: "shortcut";
  target: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  route?: string;
}

export type StepResult = { type: "next"; route: string } | { type: "end"; name: string };

export interface StepScope extends Disposable {
  readonly signal: AbortSignal;
  readonly disposed: boolean;
  onDispose(cleanup: () => void | Promise<void>): void;
  guard<T>(task: Promise<T>): Promise<T>;
  waitEvent<K extends keyof KioskEvents>(
    name: K,
    predicate?: (payload: KioskEvents[K]) => boolean,
  ): Promise<KioskEvents[K]>;
  race<T>(tasks: Array<Promise<T>>): Promise<T>;
}

export interface StepContext {
  readonly flowId: string;
  readonly nodeId: string;
  readonly scope: StepScope;
  readonly events: TypedEventBus<KioskEvents>;
  readonly commands: TypedCommandBus<KioskCommands>;
  readonly queries: TypedQueryBus<KioskQueries>;
  readonly ui?: UiPort;
  readonly devices?: DeviceManager;
  readonly host?: HostGateway;
  readonly timeoutService?: TimeoutService;
  readonly resources?: TransactionResourceRegistry;
  readonly recovery?: RecoveryManager;
  readonly journal?: ElectronicJournal;
  readonly redaction?: RedactionService;
  readonly audit?: InteractionAuditService;
  readonly logger: Logger;
  next(route: string): StepResult;
  end(name: string): StepResult;
}

export type StepHandler = (
  ctx: StepContext,
  config?: Record<string, unknown>,
) => Promise<StepResult> | StepResult;

export interface FlowRunResult {
  flowId: string;
  endName: string;
}
