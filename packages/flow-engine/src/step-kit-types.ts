import type {
  HostResponse,
  InputSource,
  StepContext,
  StepHandler,
  TimeoutOptions,
} from "@tripley-acctron/contracts";

export type ValidationResult<TValue> = { ok: true; value: TValue } | { ok: false; error: string };

export interface TextInputValueOptions {
  initial?: string | ((ctx: StepContext) => string);
  minLength?: number;
  maxLength?: number;
  mask?: boolean;
  redactAs?: string;
}

export interface TextInputRoutes {
  accepted: string;
  cancelled?: string;
  timeout?: string;
  failed?: string;
}

export interface TextInputStepDefinition<TValue = string> {
  id: string;
  screen: string;
  timeout?: TimeoutOptions;
  audit?: "customerInput" | false;
  cancelRoute?: string;
  value?: TextInputValueOptions;
  sources: InputSource[];
  validate?(
    value: string,
    ctx: StepContext,
  ): ValidationResult<TValue> | Promise<ValidationResult<TValue>>;
  commit?(ctx: StepContext, value: TValue): void | Promise<void>;
  routes: TextInputRoutes;
}

export interface ChoiceDefinition<TValue = unknown> {
  id: string;
  label: string;
  route: string;
  value?: TValue;
}

export interface ChoiceRoutes {
  cancelled?: string;
  timeout?: string;
  failed?: string;
}

export interface ChoiceStepDefinition<TValue = unknown> {
  id: string;
  screen: string;
  state?: Record<string, unknown> | ((ctx: StepContext) => Record<string, unknown>);
  choices: Array<ChoiceDefinition<TValue>>;
  sources?: InputSource[];
  timeout?: TimeoutOptions;
  commit?(ctx: StepContext, choice: ChoiceDefinition<TValue>): void | Promise<void>;
  routes?: ChoiceRoutes;
}

export interface ConfirmRoutes {
  confirmed: string;
  cancelled?: string;
  timeout?: string;
  failed?: string;
}

export interface ConfirmStepDefinition {
  id: string;
  screen: string;
  state?: Record<string, unknown> | ((ctx: StepContext) => Record<string, unknown>);
  sources?: InputSource[];
  timeout?: TimeoutOptions;
  commit?(ctx: StepContext): void | Promise<void>;
  routes: ConfirmRoutes;
}

export interface CallbackHostRequestStepDefinition<TResponse = unknown> {
  id: string;
  request(ctx: StepContext): Promise<TResponse>;
  route(response: TResponse, ctx: StepContext): string;
  routes?: { failed?: string };
}

export interface GatewayHostRequestStepDefinition<TRequest = unknown, TResponse = unknown> {
  id: string;
  messageType: string;
  body: TRequest | ((ctx: StepContext) => TRequest);
  timeoutMs?: number;
  traceId?: string | ((ctx: StepContext) => string);
  route(response: HostResponse<TResponse>, ctx: StepContext): string;
  routes?: { failed?: string };
}

export type HostRequestStepDefinition<TResponse = unknown> =
  | CallbackHostRequestStepDefinition<TResponse>
  | GatewayHostRequestStepDefinition<unknown, TResponse>;

export interface WaitDeviceStepDefinition<TResponse = unknown> {
  id: string;
  wait(ctx: StepContext): Promise<TResponse>;
  route(response: TResponse, ctx: StepContext): string;
  routes?: { failed?: string };
}

export type StandardStepFactory<TDefinition> = (definition: TDefinition) => StepHandler;
