import type { InteractionIntent, PinpadKey } from "@tripley-acctron/contracts";

export type PinpadFunctionKey = "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8";
export type PinpadFunctionKeyMapping = Partial<Record<PinpadFunctionKey, string>> & {
  cancel?: string;
};

export function mapUiAction(action: unknown): InteractionIntent {
  if (isActionType(action, "submit")) {
    return {
      type: "submit",
      value: "value" in action ? action.value : undefined,
      source: "ui.action",
    };
  }
  if (isActionType(action, "cancel")) {
    return { type: "cancel", source: "ui.action" };
  }
  return { type: "action", action, source: "ui.action" };
}

export function mapUiChoice(action: unknown): InteractionIntent {
  const choiceId = readStringProperty(action, "choiceId") ?? readStringProperty(action, "id");
  if (choiceId) {
    return { type: "select", choiceId, source: "ui.choice" };
  }
  if (isActionType(action, "cancel")) {
    return { type: "cancel", source: "ui.choice" };
  }
  return { type: "action", action, source: "ui.choice" };
}

export function mapUiConfirmCancel(action: unknown): InteractionIntent {
  if (isActionType(action, "confirm") || isActionType(action, "submit")) {
    return { type: "confirm", source: "ui.confirmCancel" };
  }
  if (isActionType(action, "cancel")) {
    return { type: "cancel", source: "ui.confirmCancel" };
  }
  return { type: "action", action, source: "ui.confirmCancel" };
}

export function mapPinpadKey(key: PinpadKey): InteractionIntent {
  if (isDigit(key)) {
    return { type: "append", text: key, source: "pinpad.numeric" };
  }
  if (key === "enter") {
    return { type: "submit", source: "pinpad.numeric" };
  }
  if (key === "cancel") {
    return { type: "cancel", source: "pinpad.numeric" };
  }
  if (key === "clear") {
    return { type: "clear", source: "pinpad.numeric" };
  }
  return { type: "backspace", source: "pinpad.numeric" };
}

export function mapFunctionKey(
  key: PinpadKey,
  mapping: PinpadFunctionKeyMapping,
): InteractionIntent {
  if (key === "cancel" && mapping.cancel) {
    return { type: "cancel", source: "pinpad.functionKeys" };
  }
  if (isFunctionKey(key)) {
    const choiceId = mapping[key];
    if (choiceId) {
      return { type: "select", choiceId, source: "pinpad.functionKeys" };
    }
  }
  return { type: "action", action: { type: "pinpadKey", key }, source: "pinpad.functionKeys" };
}

export function mapPinpadConfirmCancel(key: PinpadKey): InteractionIntent {
  if (key === "enter") {
    return { type: "confirm", source: "pinpad.confirmCancel" };
  }
  if (key === "cancel") {
    return { type: "cancel", source: "pinpad.confirmCancel" };
  }
  return { type: "action", action: { type: "pinpadKey", key }, source: "pinpad.confirmCancel" };
}

function isDigit(key: PinpadKey): boolean {
  return key >= "0" && key <= "9";
}

function isFunctionKey(key: PinpadKey): key is PinpadFunctionKey {
  return key >= "f1" && key <= "f8";
}

function isActionType(action: unknown, type: string): action is { type: string; value?: unknown } {
  return typeof action === "object" && action !== null && "type" in action && action.type === type;
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return undefined;
  }
  const propertyValue = value[property as keyof typeof value];
  return typeof propertyValue === "string" ? propertyValue : undefined;
}
