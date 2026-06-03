import type {
  Clock,
  JournalEntry,
  JournalPort,
  PresentationPort,
  RecoveryPort,
  RecoveryReason,
  TimeoutContext,
  TimeoutDecisionPort,
  TtsPort,
  TtsRequest,
  VoiceGuidePort,
  VoiceGuideRequest,
} from "@tripley-acctron/contracts";

export class MemoryJournal implements JournalPort {
  public readonly entries: JournalEntry[] = [];
  public async append(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export class MemoryPresentation<TState = unknown> implements PresentationPort<TState> {
  public readonly navigations: Array<{ viewId: string; state: TState }> = [];
  public readonly states: TState[] = [];
  public async navigate(viewId: string, state: TState): Promise<void> {
    this.navigations.push({ viewId, state });
  }
  public async setState(state: TState): Promise<void> {
    this.states.push(state);
  }
}

export class MemoryRecovery implements RecoveryPort {
  public readonly reasons: RecoveryReason[] = [];
  public async releaseAllHeldMedia(reason: RecoveryReason): Promise<void> {
    this.reasons.push(reason);
  }
}

export class MemoryTimeoutDecision implements TimeoutDecisionPort {
  public readonly contexts: TimeoutContext[] = [];
  public constructor(private readonly answer: "yes" | "no") {}
  public async requestMoreTime(context: TimeoutContext): Promise<"yes" | "no"> {
    this.contexts.push(context);
    return this.answer;
  }
}

export class MemoryTts implements TtsPort {
  public readonly requests: TtsRequest[] = [];
  public async speak(request: TtsRequest): Promise<void> {
    this.requests.push(request);
  }
  public async stop(): Promise<void> {}
}

export class MemoryVoiceGuide implements VoiceGuidePort {
  public readonly requests: VoiceGuideRequest[] = [];
  public async play(request: VoiceGuideRequest): Promise<void> {
    this.requests.push(request);
  }
  public async stop(): Promise<void> {}
}

interface Timer {
  at: number;
  callback: () => void;
  id: number;
}

export class FakeClock implements Clock {
  private currentMs = 0;
  private nextId = 1;
  private readonly timers = new Map<number, Timer>();

  public now(): Date {
    return new Date(this.currentMs);
  }

  public setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.currentMs + delayMs, callback, id });
    return id;
  }

  public clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  public async advanceBy(delayMs: number): Promise<void> {
    this.currentMs += delayMs;
    const due = [...this.timers.values()].filter((timer) => timer.at <= this.currentMs);
    for (const timer of due.sort((left, right) => left.at - right.at)) {
      this.timers.delete(timer.id);
      timer.callback();
      await Promise.resolve();
    }
  }
}
