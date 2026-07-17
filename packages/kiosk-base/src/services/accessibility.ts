export type AccessibilityMode = "standard" | "blind" | "lowVision" | "headphone";

export interface AccessibilityState {
  readonly mode: AccessibilityMode;
  readonly verbosePrompts: boolean;
  readonly ttsEnabled: boolean;
}

export class AccessibilityService {
  private state: AccessibilityState = {
    mode: "standard",
    ttsEnabled: false,
    verbosePrompts: false,
  };

  public getState(): AccessibilityState {
    return this.state;
  }

  public setMode(mode: AccessibilityMode): AccessibilityState {
    this.state =
      mode === "blind" || mode === "headphone"
        ? { mode, ttsEnabled: true, verbosePrompts: true }
        : { mode, ttsEnabled: mode === "lowVision", verbosePrompts: false };
    return this.state;
  }
}
