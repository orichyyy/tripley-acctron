import type { WithdrawalOutcome } from "@tripley-kit/web-container-withdrawal-orchestration";

import type { BspV243IwdContext } from "../../script/bsp-v243/withdrawal-contracts";

export class TaiwanBspWithdrawalContextVault {
  readonly #contexts = new Map<string, BspV243IwdContext>();

  public bind(operationId: string, context: BspV243IwdContext): void {
    if (!operationId.trim() || this.#contexts.has(operationId)) {
      throw new Error("taiwan.bsp.withdrawal-context.bind-rejected");
    }
    this.#contexts.set(operationId, context);
  }

  public require(operationId: string): BspV243IwdContext {
    const context = this.#contexts.get(operationId);
    if (!context) throw new Error("taiwan.bsp.withdrawal-context.missing");
    return context;
  }

  public clear(operationId: string): void {
    this.#contexts.delete(operationId);
  }

  public has(operationId: string): boolean {
    return this.#contexts.has(operationId);
  }
}

export const createTaiwanBspWithdrawalHostContextProviders = (
  vault: TaiwanBspWithdrawalContextVault,
) => ({
  authorization: async (input: { readonly operationId: string }) =>
    vault.require(input.operationId),
  completion: async (input: {
    readonly operationId: string;
    readonly authorizationReference?: string | undefined;
    readonly outcome: WithdrawalOutcome;
  }): Promise<BspV243IwdContext & {
    readonly originalCenterSequence: string;
    readonly originalAtmSequence: string;
    readonly originalAtmSystemDate: string;
  }> => {
    const context = vault.require(input.operationId);
    return {
      ...context,
      ici: {
        ...context.ici,
        inChipTac: "",
        inMac: "00000000",
        inPinBlock: "0000000000000000",
        inTrack3: "",
      },
      originalAtmSequence: context.header.sequence,
      originalAtmSystemDate: context.header.systemDate,
      originalCenterSequence: input.authorizationReference ?? "",
    };
  },
});
