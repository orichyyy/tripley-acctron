import { XfsPinCompletion } from "@tripley-kit/xfs-client";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import type { XfsPinEventLike } from "./types";
import { hResultOf } from "./utils";

const WFS_ERR_CANCELED = -4;

export interface XfsPinInputFeedback {
  readonly digitCount: number;
  readonly state: "started" | "changed" | "cleared" | "terminated";
}

type PinInputFeedbackHandler = (feedback: XfsPinInputFeedback) => void;

export class PinpadInputControl {
  public completionRequested = false;
  public digitCount = 0;
  public phase: "entry" | "result" = "entry";
  public readonly maxLength: number;
  public readonly minLength: number;
  private readonly onFeedback: PinInputFeedbackHandler | undefined;

  public constructor(
    public readonly operationId: string,
    options: unknown,
  ) {
    const input = asRecord(options);
    this.maxLength = numberValue(input.maxLength ?? input.maxLen, 12);
    this.minLength = numberValue(input.minLength ?? input.minLen, 0);
    this.onFeedback = typeof input.onFeedback === "function"
      ? input.onFeedback as PinInputFeedbackHandler
      : undefined;
    this.emit("started");
  }

  public handle(event: XfsPinEventLike): void {
    const completion = completionFromEvent(event);
    if (completion === undefined) return;
    if (completion === XfsPinCompletion.Clear) {
      this.digitCount = 0;
      this.emit("cleared");
    } else if (completion === XfsPinCompletion.Backspace) {
      this.digitCount = Math.max(0, this.digitCount - 1);
      this.emit("changed");
    } else if (completion === XfsPinCompletion.Enter || completion === XfsPinCompletion.Cancel) {
      this.emit("terminated");
    } else if (completion === XfsPinCompletion.Continue) {
      this.digitCount = Math.min(this.maxLength, this.digitCount + 1);
      this.emit("changed");
    }
  }

  public beginCompletion(): void {
    if (this.phase !== "entry") {
      throw inputError("xfs.pin.input.noPending", "PIN entry is no longer pending.");
    }
    if (this.digitCount < this.minLength) {
      throw new FrameworkError({
        category: "dependency",
        code: "xfs.pin.input.minLength",
        message: "PIN input is shorter than the configured minimum length.",
        metadata: { digitCount: this.digitCount, minLength: this.minLength },
      });
    }
    this.completionRequested = true;
  }

  public rollbackCompletion(): void {
    this.completionRequested = false;
  }

  public assertCommandResult(result: unknown, action: string): void {
    const hResult = hResultOf(result);
    if (hResult === 0 || (this.completionRequested && hResult === WFS_ERR_CANCELED)) return;
    throw new FrameworkError({
      category: "native",
      code: "xfs.command.failed",
      message: `XFS command failed during ${action}.`,
      metadata: { hResult },
    });
  }

  private emit(state: XfsPinInputFeedback["state"]): void {
    try {
      this.onFeedback?.({ digitCount: this.digitCount, state });
    } catch {
      // Presentation feedback cannot alter secure PIN command control.
    }
  }
}

const completionFromEvent = (event: XfsPinEventLike): number | undefined => {
  if (event.data?.kind !== "key") return undefined;
  const value = asRecord(event.data.value);
  return typeof value.completion === "number" ? value.completion : undefined;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const numberValue = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

const inputError = (code: string, message: string): FrameworkError =>
  new FrameworkError({ category: "dependency", code, message });
