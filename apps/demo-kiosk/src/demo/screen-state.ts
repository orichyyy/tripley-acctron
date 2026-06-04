import type { UiRuntimeSnapshot } from "@tripley-acctron/react-ui";
import type { AccountInputState, HostScenario, ResultState, WelcomeState } from "./screens";

export function welcomeState(snapshot: UiRuntimeSnapshot): WelcomeState {
  return isRecord(snapshot.screenState) && snapshot.currentScreen === "demo.welcome"
    ? { scenario: scenarioValue(snapshot.screenState.scenario) }
    : { scenario: "approved" };
}

export function accountInputState(snapshot: UiRuntimeSnapshot): AccountInputState {
  if (!isRecord(snapshot.screenState)) {
    return { value: "" };
  }
  const value = typeof snapshot.screenState.value === "string" ? snapshot.screenState.value : "";
  const error =
    typeof snapshot.screenState.error === "string" ? snapshot.screenState.error : undefined;
  return error ? { value, error } : { value };
}

export function resultState(snapshot: UiRuntimeSnapshot): ResultState {
  if (!isRecord(snapshot.screenState)) {
    return {
      title: "No result",
      message: "The flow has not produced a result yet.",
      tone: "warning",
      endName: "Unknown",
    };
  }
  const accountNo =
    typeof snapshot.screenState.accountNo === "string" ? snapshot.screenState.accountNo : undefined;
  return Object.assign(
    {
      title: stringValue(snapshot.screenState.title, "Result"),
      message: stringValue(snapshot.screenState.message, "The transaction finished."),
      tone: toneValue(snapshot.screenState.tone),
      endName: stringValue(snapshot.screenState.endName, "Unknown"),
    },
    accountNo ? { accountNo } : {},
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scenarioValue(value: unknown): HostScenario {
  return value === "declined" || value === "failed" ? value : "approved";
}

function toneValue(value: unknown): ResultState["tone"] {
  return value === "success" || value === "danger" ? value : "warning";
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
