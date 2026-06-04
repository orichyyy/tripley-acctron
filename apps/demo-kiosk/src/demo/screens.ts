import type { ScreenMap } from "@tripley-acctron/contracts";

export type HostScenario = "approved" | "declined" | "failed";

export interface WelcomeState {
  scenario: HostScenario;
}

export interface AccountInputState {
  value: string;
  error?: string;
}

export interface ProcessingState {
  accountNo?: string;
}

export interface ResultState {
  title: string;
  message: string;
  tone: "success" | "warning" | "danger";
  endName: string;
  accountNo?: string;
}

export interface DemoScreens extends ScreenMap {
  [screen: string]: {
    state: unknown;
    actions: unknown;
  };
  "demo.welcome": {
    state: WelcomeState;
    actions: { type: "start"; scenario: HostScenario };
  };
  "account.input": {
    state: AccountInputState;
    actions: { type: "submit"; value?: string } | { type: "cancel" };
  };
  "demo.processing": {
    state: ProcessingState;
    actions: never;
  };
  "demo.result": {
    state: ResultState;
    actions: { type: "restart" };
  };
}

export function resultStateFor(endName: string, accountNo?: string): ResultState {
  const account = accountNo ? { accountNo } : {};
  if (endName === "Success") {
    return {
      title: "Inquiry approved",
      message: "The account inquiry completed through the Recipe flow and fake host.",
      tone: "success",
      endName,
      ...account,
    };
  }
  if (endName === "Declined") {
    return {
      title: "Inquiry declined",
      message: "The fake host returned an approved=false response and the flow routed to Declined.",
      tone: "warning",
      endName,
      ...account,
    };
  }
  return {
    title: `${endName} route`,
    message: "The transaction finished through a non-success route.",
    tone: endName === "Cancelled" || endName === "Timeout" ? "warning" : "danger",
    endName,
    ...account,
  };
}
