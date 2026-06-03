import {
  KioskError,
  type InputSource,
  type InputSourceContext,
  type InputSourceSession,
  type InteractionIntent,
  type BarcodeParseResult,
  type PinpadKey,
} from "@tripley-acctron/contracts";

export interface UiActionSourceOptions {
  screen: string;
}

export interface BarcodeQrSourceOptions {
  sourceId?: string;
  parse?(text: string): BarcodeParseResult | Promise<BarcodeParseResult>;
}

export interface PinpadFunctionKeyOptions {
  mapping: Partial<Record<PinpadFunctionKey, string>> & { cancel?: string };
}

export const InputSources = {
  none(): InputSource {
    return new NoneInputSource();
  },

  ui: {
    action(screenOrOptions: string | UiActionSourceOptions): InputSource {
      const screen = typeof screenOrOptions === "string" ? screenOrOptions : screenOrOptions.screen;
      return new UiActionInputSource(screen);
    },

    choice(screenOrOptions: string | UiActionSourceOptions): InputSource {
      const screen = typeof screenOrOptions === "string" ? screenOrOptions : screenOrOptions.screen;
      return new UiChoiceInputSource(screen);
    },

    confirmCancel(screenOrOptions: string | UiActionSourceOptions): InputSource {
      const screen = typeof screenOrOptions === "string" ? screenOrOptions : screenOrOptions.screen;
      return new UiConfirmCancelInputSource(screen);
    },
  },

  pinpad: {
    numeric(): InputSource {
      return new PinpadNumericInputSource();
    },

    functionKeys(options: PinpadFunctionKeyOptions): InputSource {
      return new PinpadFunctionKeyInputSource(options.mapping);
    },

    confirmCancel(): InputSource {
      return new PinpadConfirmCancelInputSource();
    },
  },

  barcode: {
    qr(options: BarcodeQrSourceOptions = {}): InputSource {
      return new BarcodeQrInputSource(options.sourceId ?? "barcode.qr", options.parse);
    },
  },
};

type PinpadFunctionKey = "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8";

class NoneInputSource implements InputSource {
  public readonly id = "none";

  public async start(): Promise<InputSourceSession> {
    return {
      next: () => new Promise<InteractionIntent>(() => {}),
      stop: async () => {},
    };
  }
}

class UiActionInputSource implements InputSource {
  public readonly id = "ui.action";

  public constructor(private readonly screen: string) {}

  public async start(ctx: InputSourceContext): Promise<InputSourceSession> {
    if (!ctx.ui) {
      throw new KioskError("interaction.sourceMissing", "UiActionInputSource requires a UiPort.");
    }
    const ui = ctx.ui;
    return {
      next: async () => mapUiAction(await ui.waitAction(this.screen, { signal: ctx.signal })),
      stop: async () => {},
    };
  }
}

class UiChoiceInputSource implements InputSource {
  public readonly id = "ui.choice";

  public constructor(private readonly screen: string) {}

  public async start(ctx: InputSourceContext): Promise<InputSourceSession> {
    if (!ctx.ui) {
      throw new KioskError("interaction.sourceMissing", "UiChoiceInputSource requires a UiPort.");
    }
    const ui = ctx.ui;
    return {
      next: async () => mapUiChoice(await ui.waitAction(this.screen, { signal: ctx.signal })),
      stop: async () => {},
    };
  }
}

class UiConfirmCancelInputSource implements InputSource {
  public readonly id = "ui.confirmCancel";

  public constructor(private readonly screen: string) {}

  public async start(ctx: InputSourceContext): Promise<InputSourceSession> {
    if (!ctx.ui) {
      throw new KioskError(
        "interaction.sourceMissing",
        "UiConfirmCancelInputSource requires a UiPort.",
      );
    }
    const ui = ctx.ui;
    return {
      next: async () =>
        mapUiConfirmCancel(await ui.waitAction(this.screen, { signal: ctx.signal })),
      stop: async () => {},
    };
  }
}

class PinpadNumericInputSource implements InputSource {
  public readonly id = "pinpad.numeric";

  public async start(ctx: InputSourceContext): Promise<InputSourceSession> {
    if (!ctx.devices?.pinpad) {
      throw new KioskError(
        "interaction.sourceMissing",
        "PinpadNumericInputSource requires a pinpad device.",
      );
    }
    const pinpad = ctx.devices.pinpad;
    return {
      next: async () => mapPinpadKey(await pinpad.waitKey({ signal: ctx.signal })),
      stop: async () => pinpad.cancel(),
    };
  }
}

class PinpadFunctionKeyInputSource implements InputSource {
  public readonly id = "pinpad.functionKeys";

  public constructor(private readonly mapping: PinpadFunctionKeyOptions["mapping"]) {}

  public async start(ctx: InputSourceContext): Promise<InputSourceSession> {
    if (!ctx.devices?.pinpad) {
      throw new KioskError(
        "interaction.sourceMissing",
        "PinpadFunctionKeyInputSource requires a pinpad device.",
      );
    }
    const pinpad = ctx.devices.pinpad;
    return {
      next: async () => mapFunctionKey(await pinpad.waitKey({ signal: ctx.signal }), this.mapping),
      stop: async () => pinpad.cancel(),
    };
  }
}

class PinpadConfirmCancelInputSource implements InputSource {
  public readonly id = "pinpad.confirmCancel";

  public async start(ctx: InputSourceContext): Promise<InputSourceSession> {
    if (!ctx.devices?.pinpad) {
      throw new KioskError(
        "interaction.sourceMissing",
        "PinpadConfirmCancelInputSource requires a pinpad device.",
      );
    }
    const pinpad = ctx.devices.pinpad;
    return {
      next: async () => mapPinpadConfirmCancel(await pinpad.waitKey({ signal: ctx.signal })),
      stop: async () => pinpad.cancel(),
    };
  }
}

class BarcodeQrInputSource implements InputSource {
  public constructor(
    public readonly id: string,
    private readonly parse?: (text: string) => BarcodeParseResult | Promise<BarcodeParseResult>,
  ) {}

  public async start(ctx: InputSourceContext): Promise<InputSourceSession> {
    if (!ctx.devices?.barcodeReader) {
      throw new KioskError(
        "interaction.sourceMissing",
        "BarcodeQrInputSource requires a barcode reader device.",
      );
    }
    const reader = ctx.devices.barcodeReader;
    return {
      next: async () => {
        const result = await reader.read({ signal: ctx.signal });
        const parsed = this.parse ? await this.parse(result.text) : undefined;
        return parsed
          ? { type: "scan", text: result.text, source: this.id, parsed }
          : { type: "scan", text: result.text, source: this.id };
      },
      stop: async () => reader.cancel(),
    };
  }
}

function mapUiAction(action: unknown): InteractionIntent {
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

function mapUiChoice(action: unknown): InteractionIntent {
  const choiceId = readStringProperty(action, "choiceId") ?? readStringProperty(action, "id");
  if (choiceId) {
    return { type: "select", choiceId, source: "ui.choice" };
  }
  if (isActionType(action, "cancel")) {
    return { type: "cancel", source: "ui.choice" };
  }
  return { type: "action", action, source: "ui.choice" };
}

function mapUiConfirmCancel(action: unknown): InteractionIntent {
  if (isActionType(action, "confirm")) {
    return { type: "confirm", source: "ui.confirmCancel" };
  }
  if (isActionType(action, "submit")) {
    return { type: "confirm", source: "ui.confirmCancel" };
  }
  if (isActionType(action, "cancel")) {
    return { type: "cancel", source: "ui.confirmCancel" };
  }
  return { type: "action", action, source: "ui.confirmCancel" };
}

function mapPinpadKey(key: PinpadKey): InteractionIntent {
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

function mapFunctionKey(
  key: PinpadKey,
  mapping: PinpadFunctionKeyOptions["mapping"],
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

function mapPinpadConfirmCancel(key: PinpadKey): InteractionIntent {
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
