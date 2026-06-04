import type { ElectronicJournal, JournalEntry } from "@tripley-acctron/contracts";

export class InMemoryElectronicJournal implements ElectronicJournal {
  public readonly entries: JournalEntry[] = [];

  public async write(entry: JournalEntry): Promise<void> {
    this.entries.push(entry.timestamp ? entry : { ...entry, timestamp: Date.now() });
  }
}
