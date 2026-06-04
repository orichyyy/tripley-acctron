import type {
  AuditChoice,
  AuditInput,
  AuditPrompt,
  ElectronicJournal,
  InteractionAuditService,
  Logger,
  RedactionService,
} from "@tripley-acctron/contracts";
import { DefaultRedactionService } from "./redaction";

export interface DefaultInteractionAuditServiceOptions {
  logger: Logger;
  journal: ElectronicJournal;
  redaction?: RedactionService;
}

export class DefaultInteractionAuditService implements InteractionAuditService {
  private readonly redaction: RedactionService;

  public constructor(private readonly options: DefaultInteractionAuditServiceOptions) {
    this.redaction = options.redaction ?? new DefaultRedactionService();
  }

  public async beginPrompt(prompt: AuditPrompt): Promise<void> {
    await this.write("interaction.prompt.begin", prompt);
  }

  public async recordCustomerChoice(choice: AuditChoice): Promise<void> {
    await this.write("interaction.choice", choice);
  }

  public async recordCustomerInput(input: AuditInput): Promise<void> {
    const data = {
      ...input,
      value:
        input.value === undefined || !input.redactAs
          ? input.value
          : this.redaction.redactValue(input.redactAs, input.value),
    };
    await this.write("interaction.input", data);
  }

  public async endPrompt(promptId: string): Promise<void> {
    await this.write("interaction.prompt.end", { promptId });
  }

  private async write(type: string, payload: unknown): Promise<void> {
    const data = this.redaction.redact(type, payload);
    this.options.logger.info(type, { data });
    await this.options.journal.write({ type, data });
  }
}
