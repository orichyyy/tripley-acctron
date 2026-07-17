export interface PromptCatalogEntry {
  readonly key: string;
  readonly locale: string;
  readonly text: string;
}

export class PromptCatalog {
  private readonly prompts = new Map<string, string>();

  public constructor(entries: readonly PromptCatalogEntry[] = []) {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  public register(entry: PromptCatalogEntry): void {
    this.prompts.set(promptKey(entry.locale, entry.key), entry.text);
  }

  public translate(key: string, locale: string, params: Record<string, unknown> = {}): string {
    const template =
      this.prompts.get(promptKey(locale, key)) ?? this.prompts.get(promptKey("en", key));
    if (!template) {
      return key;
    }
    return template.replace(/\{([^}]+)\}/g, (_match, name: string) => String(params[name] ?? ""));
  }
}

const promptKey = (locale: string, key: string): string => `${locale}:${key}`;
