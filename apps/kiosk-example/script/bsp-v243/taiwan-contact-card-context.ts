import { BspCredentialMapperRegistry } from "./credential-mapper-registry";
import {
  BspOperationContextError,
  type BspOperationClockPort,
  type BspOperationSequencePort,
  type BspRequestSecurityPort,
  type BspTerminalConfiguration,
} from "./operation-context-contracts";
import {
  BspV243OperationContextAssembler,
  type BspV243OperationContextAssemblerOptions,
} from "./operation-context-assembler";
import { createBspXfsIdcCredentialMapper } from "./xfs-idc-credential-mapper";

export interface TaiwanBspTrack2AccountInput {
  readonly operationId: string;
  readonly pan: string;
  readonly track2: string;
}

export interface TaiwanBspContactCardContextOptions {
  readonly amountMultiplier?: number;
  readonly bankNumber: string;
  readonly clock: BspOperationClockPort;
  readonly pinAuthenticationKey?: string;
  readonly security: BspRequestSecurityPort;
  readonly sequence: BspOperationSequencePort;
  readonly terminal: BspTerminalConfiguration;
  readonly track2Source: number;
  resolveTransactionAccount(
    input: TaiwanBspTrack2AccountInput,
  ): string | Promise<string>;
}

export function createTaiwanBspContactCardContextAssembler(
  options: TaiwanBspContactCardContextOptions,
): BspV243OperationContextAssembler {
  requireDigits(options.bankNumber, 3, "inBankNumber");
  if (!Number.isSafeInteger(options.track2Source) || options.track2Source <= 0) {
    throw new BspOperationContextError(
      "BSP_CONFIGURATION_INVALID",
      "IDC Track 2 source must be a positive integer",
      "track2Source",
    );
  }

  const credentialMappers = new BspCredentialMapperRegistry();
  credentialMappers.register(
    createBspXfsIdcCredentialMapper({
      entryMethodIds: ["card.contact"],
      id: "taiwan-bsp.xfs-idc.track2",
      requiredSources: [options.track2Source],
      resolve: async (card, input) => {
        const track2 = card.requireText(options.track2Source);
        const pan = parseTaiwanBspTrack2Pan(track2);
        const transactionAccount = await options.resolveTransactionAccount({
          operationId: input.operationId,
          pan,
          track2,
        });
        requireDigits(transactionAccount, 16, "inTransactionAccount");
        return {
          ici: {
            inBankNumber: options.bankNumber,
            inCardAccount: pan,
            inTrack3: track2,
            inTransactionAccount: transactionAccount,
          },
        };
      },
      version: "2.43",
    }),
  );

  const assemblerOptions: BspV243OperationContextAssemblerOptions = {
    clock: options.clock,
    credentialMappers,
    security: options.security,
    sequence: options.sequence,
    terminal: options.terminal,
    ...(options.amountMultiplier === undefined
      ? {}
      : { amountMultiplier: options.amountMultiplier }),
    ...(options.pinAuthenticationKey === undefined
      ? {}
      : { pinAuthenticationKey: options.pinAuthenticationKey }),
  };
  return new BspV243OperationContextAssembler(assemblerOptions);
}

export function parseTaiwanBspTrack2Pan(track2: string): string {
  const separator = track2.search(/[=D]/u);
  const pan = separator < 0 ? "" : track2.slice(0, separator);
  requireDigits(pan, 16, "inCardAccount");
  return pan;
}

function requireDigits(
  value: string,
  width: number,
  fieldId: string,
): string {
  if (!new RegExp(`^\\d{${width}}$`, "u").test(value)) {
    throw new BspOperationContextError(
      "BSP_FIELD_INVALID",
      `${fieldId} must contain exactly ${width} digits`,
      fieldId,
    );
  }
  return value;
}
