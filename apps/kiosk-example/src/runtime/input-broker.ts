import type {
  InputSourceAdapter,
  InputSourceKind,
  InputSourceSession,
  UserInputSourceResult,
} from "@tripley/web-container-device-core";
import { FrameworkError } from "@tripley/web-container-errors";

export interface BrokerInputOptions {
  readonly promptId?: string | undefined;
  readonly inputMode?: "numeric" | "text" | "password" | "action" | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly secure?: boolean | undefined;
}

interface PendingRequest {
  readonly id: string;
  readonly kind: string;
  readonly resolve: (result: UserInputSourceResult) => void;
  readonly reject: (error: unknown) => void;
}

export class UiInputBroker {
  private pending: PendingRequest | undefined;

  public createAdapter(kind: InputSourceKind = "ui.command"): InputSourceAdapter {
    return {
      canStart: () => true,
      kind,
      start: async (_ctx, source) => this.start(kind, source.id),
    };
  }

  public submit(value: string): void {
    const pending = this.pending;
    if (!pending) {
      throw brokerError("inputBroker.noPendingInput", "No customer input is pending.");
    }
    this.pending = undefined;
    pending.resolve({
      kind: "plain",
      safeSummary: { hasValue: value.length > 0, length: value.length, sourceKind: pending.kind },
      source: { id: pending.id, kind: pending.kind },
      value,
    });
  }

  public submitSecureConfirmation(): void {
    const pending = this.pending;
    if (!pending) {
      throw brokerError("inputBroker.noPendingInput", "No secure input is pending.");
    }
    this.pending = undefined;
    pending.resolve({
      encryptedPinBlock: "MEMORY-ADAPTER-PIN-BLOCK",
      kind: "securePin",
      safeSummary: { hasEncryptedPinBlock: true, sourceKind: pending.kind },
      source: { id: pending.id, kind: pending.kind },
    } as UserInputSourceResult);
  }

  public cancel(reason = "input.cancelled"): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(brokerError(reason, "Customer input was cancelled."));
  }

  private start(kind: string, id: string): InputSourceSession {
    if (this.pending) {
      throw brokerError("inputBroker.busy", "Another customer input is already pending.");
    }
    const result = new Promise<UserInputSourceResult>((resolve, reject) => {
      this.pending = { id, kind, reject, resolve };
    });
    return {
      cancel: async (reason) => this.cancel(reason),
      id: `broker.${id}`,
      result,
      sourceId: id,
      sourceKind: kind,
    };
  }
}

const brokerError = (code: string, message: string): FrameworkError =>
  new FrameworkError({ category: "dependency", code, message });
