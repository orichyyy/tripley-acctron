import type {
  BarcodeParseResult,
  CardEjectResult,
  CardInsertedResult,
  StepContext,
  TimeoutOptions,
} from "@tripley-acctron/contracts";

export interface InputAccountConstraints {
  minLength?: number;
  maxLength?: number;
}

export interface InputAccountSources {
  pinpad?: boolean;
  barcodeQr?: boolean | { parse?(text: string): BarcodeParseResult | Promise<BarcodeParseResult> };
  uiActions?: boolean;
}

export interface InputAccountRoutes {
  valid: string;
  cancel?: string;
  timeout?: string;
  failed?: string;
}

export interface InputAccountRecipe {
  id: string;
  screen: string;
  saveAs: string;
  constraints?: InputAccountConstraints;
  timeout?: TimeoutOptions;
  sources?: InputAccountSources;
  voiceGuide?: string | false;
  routes: InputAccountRoutes;
}

export interface WaitCardInsertedRoutes {
  inserted: string;
  timeout?: string;
  error?: string;
}

export interface WaitCardInsertedRecipe {
  id: string;
  timeout?: TimeoutOptions;
  routes: WaitCardInsertedRoutes;
}

export interface EjectCardRoutes {
  taken: string;
  retained?: string;
  failed?: string;
}

export interface EjectCardRecipe {
  id: string;
  screen?: string;
  timeoutMs?: number;
  retainReason?: string;
  routes: EjectCardRoutes;
}

export type DeviceWaitResult<T> = { type: "done"; value: T } | { type: "timeout" };

export type WaitCardInsertedResult = DeviceWaitResult<CardInsertedResult>;
export type EjectCardResult = CardEjectResult;

export type RecipeCommit<T> = (ctx: StepContext, value: T) => void | Promise<void>;
