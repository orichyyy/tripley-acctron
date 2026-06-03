import type { Logger } from "./observability";
import type { TimeoutOptions } from "./timeout";
import type { ScreenMap, UiPort } from "./ui";
import type { DeviceManager } from "./native";

export type InteractionIntent =
  | { type: "append"; text: string; source: string }
  | { type: "backspace"; source: string }
  | { type: "clear"; source: string }
  | { type: "submit"; value?: unknown; source: string }
  | { type: "cancel"; source: string }
  | { type: "select"; choiceId: string; source: string }
  | { type: "confirm"; source: string }
  | { type: "scan"; text: string; source: string; parsed?: BarcodeParseResult }
  | { type: "action"; action: unknown; source: string };

export type BarcodeParseResult =
  | { ok: true; value: unknown; autoSubmit?: boolean }
  | { ok: false; error: string };

export interface InputSourceContext {
  readonly signal: AbortSignal;
  readonly ui?: UiPort;
  readonly devices?: DeviceManager;
  readonly logger: Logger;
}

export interface InputSourceSession<TIntent extends InteractionIntent = InteractionIntent> {
  next(): Promise<TIntent>;
  stop(): Promise<void>;
}

export interface InputSource<TIntent extends InteractionIntent = InteractionIntent> {
  readonly id: string;
  start(ctx: InputSourceContext): Promise<InputSourceSession<TIntent>>;
}

export type InteractionAuditHook<TIntent extends InteractionIntent = InteractionIntent> = (
  intent: TIntent,
) => void | Promise<void>;

export type InteractionReducerResult<TState, TAccepted> =
  | { type: "state"; state: TState }
  | { type: "accepted"; value: TAccepted }
  | { type: "cancelled" }
  | { type: "timeout" }
  | { type: "failed"; error: unknown };

export type InteractionRunResult<TAccepted> =
  | { type: "accepted"; value: TAccepted }
  | { type: "cancelled" }
  | { type: "timeout" }
  | { type: "failed"; error: unknown };

export interface InteractionReducerContext<TState, TAccepted> {
  accept(value: TAccepted): InteractionReducerResult<TState, TAccepted>;
  cancel(): InteractionReducerResult<TState, TAccepted>;
  timeout(): InteractionReducerResult<TState, TAccepted>;
  fail(error: unknown): InteractionReducerResult<TState, TAccepted>;
  update(state: TState): InteractionReducerResult<TState, TAccepted>;
}

export interface InteractionRuntimeOptions<
  Screens extends ScreenMap,
  TScreen extends keyof Screens,
  TState,
  TAccepted,
> {
  screen: TScreen;
  initialState: TState;
  render(state: TState): Screens[TScreen]["state"];
  sources(state: TState): Array<InputSource>;
  reduce(
    state: TState,
    intent: InteractionIntent,
    ctx: InteractionReducerContext<TState, TAccepted>,
  ):
    | InteractionReducerResult<TState, TAccepted>
    | Promise<InteractionReducerResult<TState, TAccepted>>;
  timeout?: TimeoutOptions;
  auditIntent?: InteractionAuditHook;
}
