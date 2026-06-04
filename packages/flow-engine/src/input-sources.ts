import {
  KioskError,
  type InputSource,
  type InputSourceContext,
  type InputSourceSession,
  type InteractionIntent,
  type BarcodeParseResult,
} from "@tripley-acctron/contracts";
import {
  type PinpadFunctionKeyMapping,
  mapFunctionKey,
  mapPinpadConfirmCancel,
  mapPinpadKey,
  mapUiAction,
  mapUiChoice,
  mapUiConfirmCancel,
} from "./input-source-mappers";

export interface UiActionSourceOptions {
  screen: string;
}

export interface BarcodeQrSourceOptions {
  sourceId?: string;
  parse?(text: string): BarcodeParseResult | Promise<BarcodeParseResult>;
}

export interface PinpadFunctionKeyOptions {
  mapping: PinpadFunctionKeyMapping;
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
