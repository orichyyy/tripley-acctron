import { InMemoryOperationLedger } from "@tripley-kit/web-container-kiosk-base";
import type { PromptPresenterPort } from "@tripley-kit/web-container-prompt-presentation";
import { MemoryScopedStore } from "@tripley-kit/web-container-scoped-store";
import { FrameworkUiPort, MemoryUiStateAdapter } from "@tripley-kit/web-container-ui-port";
import { describe, expect, it } from "vitest";

import { createKioskRuntime } from "./runtime";
import type {
  AuthenticationChallengeContribution,
  EntryMethodContribution,
  KioskRuntimeOptions,
} from "./types";

describe("KioskRuntime", () => {
  it("fails fast when cash safety has no launcher supervision contract", async () => {
    const configured = options({ entries: [entry("card", [])] });
    const runtime = createKioskRuntime({
      ...configured,
      cashSafety: { enabled: true, restartWindowMs: 30_000 },
    });

    await expect(runtime.initialize()).rejects.toThrow(/launcher supervision/i);
  });

  it("blocks customer operations while startup cash recovery is unresolved", async () => {
    const configured = options({ entries: [entry("card", [])] });
    const audit: unknown[] = [];
    const runtime = createKioskRuntime({
      ...configured,
      cashSafety: { enabled: true, restartWindowMs: 30_000 },
      ports: {
        ...configured.ports,
        audit: { append: async (event) => { audit.push(event); return event; } },
        launcherSupervision: {
          observeStartup: async () => ({
            previousRuntime: {
              instanceId: "runtime-old", lostAt: new Date(0).toISOString(),
            },
            runtimeInstanceId: "runtime-new",
            startedAt: new Date(31_000).toISOString(),
            watchdogHealthy: true,
          }),
        },
        recoveryStartup: {
          recover: async () => ({
            safeSummary: { unresolved: 1 }, status: "intervention" as const,
          }),
        },
      },
    });

    await runtime.initialize();

    expect(runtime.snapshot().readiness.status).toBe("intervention");
    await expect(runtime.start({ entryMethodId: "card", intentId: "blocked" }))
      .rejects.toThrow();
    expect(JSON.stringify(audit)).toContain("restartWindowBreached");
  });

  it("executes a bank reservation contribution through a locally approved challenge", async () => {
    const runtime = createKioskRuntime(
      options({
        challenges: [challenge("reservation.secret")],
        entries: [entry("reservation", ["reservation.secret"])],
      }),
    );
    await runtime.initialize();

    const result = await runtime.start({ entryMethodId: "reservation", intentId: "intent-1" });

    expect(result).toMatchObject({ entryMethodId: "reservation", status: "completed" });
    expect(runtime.snapshot().operation).toMatchObject({ phase: "completed" });
  });

  it("accepts a custom NFC plugin without changing runtime core", async () => {
    const runtime = createKioskRuntime(options());
    runtime.entryMethods.register(entry("bank.nfc", []));
    await runtime.initialize();

    const result = await runtime.start({ entryMethodId: "bank.nfc", intentId: "intent-nfc" });

    expect(result.status).toBe("completed");
    expect(runtime.snapshot().readiness.entryMethods).toEqual([
      expect.objectContaining({ available: true, id: "bank.nfc" }),
    ]);
  });

  it("fails closed when assessment requests an unknown authentication challenge", async () => {
    const runtime = createKioskRuntime(
      options({ entries: [entry("reservation", ["remote.arbitraryFlow"])] }),
    );
    await runtime.initialize();

    const result = await runtime.start({ entryMethodId: "reservation", intentId: "intent-2" });

    expect(result).toMatchObject({
      reasonCode: "authentication.challenge.unknown",
      status: "failed",
    });
  });

  it("does not allow assessed parameters to weaken mandatory authentication policy", async () => {
    let approvedMinimum = 0;
    const pinChallenge: AuthenticationChallengeContribution = {
      execute: async (_ctx, requirement) => {
        approvedMinimum = Number(requirement.parameters?.minimumLength);
        return { authenticated: true, safeSummary: { accepted: true } };
      },
      id: "pin.policy",
      validateParameters: (parameters) => {
        if (typeof parameters.minimumLength !== "number") {
          throw new Error("minimumLength is required");
        }
      },
      version: "1.0.0",
    };
    const base = entry("card", []);
    const configured = options({ challenges: [pinChallenge], entries: [base] });
    const runtime = createKioskRuntime({
      ...configured,
      entryMethods: [
        {
          ...base,
          acquisition: {
            ...base.acquisition,
            acquire: async (ctx) => ({
              ...(await base.acquisition.acquire(ctx)),
              requirements: [{ kind: "pin.policy", parameters: { minimumLength: 1 } }],
            }),
          },
        },
      ],
      mandatoryAuthentication: () => [{ kind: "pin.policy", parameters: { minimumLength: 6 } }],
    });
    await runtime.initialize();

    await expect(
      runtime.start({ entryMethodId: "card", intentId: "mandatory-policy" }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(approvedMinimum).toBe(6);
  });

  it("logs only safe operation metadata and never serializes the assessment", async () => {
    const logger = new MemoryLogger();
    const rawSecret = "RAW-CREDENTIAL-SENTINEL";
    const base = entry("reservation", []);
    const runtime = createKioskRuntime(
      options({
        entries: [
          {
            ...base,
            acquisition: {
              ...base.acquisition,
              acquire: async (ctx) => ({
                ...(await base.acquisition.acquire(ctx)),
                rawSecret,
              }),
            },
          },
        ],
        logger,
      }),
    );
    await runtime.initialize();

    await runtime.start({ entryMethodId: "reservation", intentId: "safe-log" });

    const serialized = JSON.stringify(logger.records);
    expect(serialized).toContain("operation-1");
    expect(serialized).toContain("reservation");
    expect(serialized).not.toContain(rawSecret);
  });

  it("deduplicates one intent and rejects a competing customer operation", async () => {
    let release!: () => void;
    const acquisition = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = createKioskRuntime(
      options({ entries: [entry("card", [], async () => acquisition)] }),
    );
    await runtime.initialize();

    const first = runtime.start({ entryMethodId: "card", intentId: "same-intent" });
    const duplicate = runtime.start({ entryMethodId: "card", intentId: "same-intent" });
    await expect(
      runtime.start({ entryMethodId: "card", intentId: "different-intent" }),
    ).rejects.toMatchObject({ code: "operation.alreadyActive" });
    release();

    await expect(first).resolves.toEqual(await duplicate);
  });

  it("interrupts active acquisition and cancels prompts before resetting scoped state", async () => {
    const scopedStore = new MemoryScopedStore();
    const prompt = new MemoryPromptPresenter();
    const runtime = createKioskRuntime(
      options({
        entries: [entry("card", [], (_done, signal) => waitForAbort(signal))],
        prompt,
        scopedStore,
      }),
    );
    await runtime.initialize();
    const running = runtime.start({ entryMethodId: "card", intentId: "interrupt-me" });
    await waitUntil(() => runtime.snapshot().operation.phase === "waitingCredential");

    await runtime.interrupt("route.exit");

    await expect(running).resolves.toMatchObject({
      reasonCode: "route.exit",
      status: "interrupted",
    });
    expect(prompt.cancelled).toEqual(["operation-1"]);
    expect(scopedStore.listClearHistory().at(-1)?.reason).toBe("operation.interrupted");
  });

  it("does not resolve physical custody when acquisition fails before media is held", async () => {
    let resolutionCount = 0;
    const base = entry("card", []);
    const runtime = createKioskRuntime(
      options({
        entries: [
          {
            ...base,
            acquisition: {
              ...base.acquisition,
              acquire: async () => {
                throw new Error("card was never acquired");
              },
            },
            mediaCustody: {
              kind: "physical",
              resolve: async () => {
                resolutionCount += 1;
                return { status: "returned" };
              },
            },
          },
        ],
      }),
    );
    await runtime.initialize();

    const result = await runtime.start({ entryMethodId: "card", intentId: "card-not-held" });

    expect(result).toMatchObject({ reasonCode: "operation.failed", status: "failed" });
    expect(resolutionCount).toBe(0);
  });

  it("caps interaction timeout by the configured stage policy", async () => {
    let observedTimeout = 0;
    const timedChallenge: AuthenticationChallengeContribution = {
      ...challenge("timed"),
      execute: async (ctx) => {
        observedTimeout = ctx.interactionTimeout("input");
        return { authenticated: true, safeSummary: { accepted: true } };
      },
    };
    const runtime = createKioskRuntime(
      options({ challenges: [timedChallenge], entries: [entry("card", ["timed"])] }),
    );
    await runtime.initialize();

    await runtime.start({ entryMethodId: "card", intentId: "timed-input" });

    expect(observedTimeout).toBeGreaterThan(0);
    expect(observedTimeout).toBeLessThanOrEqual(1_000);
  });

  it("bounds accessibility timeout extension without changing the hard deadline", async () => {
    let observedTimeout = 0;
    const base = entry("card", []);
    const configured = options({ entries: [base] });
    const runtime = createKioskRuntime({
      ...configured,
      accessibilityInteraction: { maximumTimeoutMultiplier: 2, timeoutMultiplier: 10 },
      entryMethods: [
        {
          ...base,
          acquisition: {
            ...base.acquisition,
            acquire: async (ctx) => {
              observedTimeout = ctx.interactionTimeout("input");
              return base.acquisition.acquire(ctx);
            },
          },
        },
      ],
    });
    await runtime.initialize();

    await runtime.start({ entryMethodId: "card", intentId: "accessible-timeout" });

    expect(observedTimeout).toBeGreaterThan(1_000);
    expect(observedTimeout).toBeLessThanOrEqual(2_000);
  });

  it("does not renew the absolute deadline after validation reentry", async () => {
    let now = 0;
    const observedTimeouts: number[] = [];
    const base = entry("reservation", []);
    const configured = options({ entries: [base] });
    const runtime = createKioskRuntime({
      ...configured,
      entryMethods: [
        {
          ...base,
          acquisition: {
            ...base.acquisition,
            acquire: async (ctx) => {
              observedTimeouts.push(ctx.interactionTimeout("input"));
              ctx.consumeAttempt("validation");
              now = 9_500;
              observedTimeouts.push(ctx.interactionTimeout("input"));
              return base.acquisition.acquire(ctx);
            },
          },
        },
      ],
      now: () => now,
      policy: {
        ...configured.policy,
        interactionTimeouts: { input: 5_000 },
        operationDeadlineMs: 10_000,
      },
    });
    await runtime.initialize();

    await runtime.start({ entryMethodId: "reservation", intentId: "deadline-reentry" });

    expect(observedTimeouts).toEqual([5_000, 500]);
  });

  it("interrupts active work when one of its required capabilities is lost", async () => {
    const dependentEntry = {
      ...entry("card", [], (_done, signal) => waitForAbort(signal)),
      requiredCapabilities: ["device.idc"],
    };
    const runtime = createKioskRuntime(
      options({ capabilities: { "device.idc": "available" }, entries: [dependentEntry] }),
    );
    await runtime.initialize();
    const running = runtime.start({ entryMethodId: "card", intentId: "device-loss" });
    await waitUntil(() => runtime.snapshot().operation.phase === "waitingCredential");

    await runtime.refreshCapabilities({ "device.idc": "unavailable" });

    await expect(running).resolves.toMatchObject({
      reasonCode: "capability.device.idc.unavailable",
      status: "interrupted",
    });
  });

  it("does not interrupt active work while a required capability is degraded", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dependentEntry = {
      ...entry("card", [], async () => pending),
      requiredCapabilities: ["device.idc"],
    };
    const runtime = createKioskRuntime(
      options({ capabilities: { "device.idc": "available" }, entries: [dependentEntry] }),
    );
    await runtime.initialize();
    const running = runtime.start({ entryMethodId: "card", intentId: "device-degraded" });
    await waitUntil(() => runtime.snapshot().operation.phase === "waitingCredential");

    await runtime.refreshCapabilities({ "device.idc": "degraded" });

    expect(runtime.snapshot().operation.phase).toBe("waitingCredential");
    release();
    await expect(running).resolves.toMatchObject({ status: "completed" });
  });

  it("does not interrupt active work when an unrelated capability is lost", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dependentEntry = {
      ...entry("card", [], async () => pending),
      requiredCapabilities: ["device.idc"],
    };
    const runtime = createKioskRuntime(
      options({
        capabilities: { "device.bcr": "available", "device.idc": "available" },
        entries: [dependentEntry],
      }),
    );
    await runtime.initialize();
    const running = runtime.start({ entryMethodId: "card", intentId: "unrelated-loss" });
    await waitUntil(() => runtime.snapshot().operation.phase === "waitingCredential");

    await runtime.refreshCapabilities({
      "device.bcr": "unavailable",
      "device.idc": "available",
    });
    expect(runtime.snapshot().operation.phase).toBe("waitingCredential");
    release();

    await expect(running).resolves.toMatchObject({ status: "completed" });
  });

  it("reconciles custody on startup without resuming credential acquisition", async () => {
    const ledger = new InMemoryOperationLedger();
    await ledger.start("withdrawal", "withdrawal:recover", {
      entryMethodId: "card",
      mediaCustody: "acquired",
      operationId: "operation-before-crash",
      phase: "processing",
    });
    const auditEvents: unknown[] = [];
    let acquisitionCount = 0;
    let reconciliationCount = 0;
    const base = entry("card", []);
    const runtime = createKioskRuntime(
      options({
        audit: {
          append: async (event) => {
            auditEvents.push(event);
            return event;
          },
        },
        entries: [
          {
            ...base,
            acquisition: {
              ...base.acquisition,
              acquire: async (ctx) => {
                acquisitionCount += 1;
                return base.acquisition.acquire(ctx);
              },
            },
            mediaCustody: {
              kind: "physical",
              reconcile: async (ctx) => {
                reconciliationCount += 1;
                expect(ctx.operationId).toBe("operation-before-crash");
                return { status: "returned" };
              },
              resolve: async () => ({ status: "returned" }),
            },
          },
        ],
        ledger,
      }),
    );

    await runtime.initialize();

    expect(acquisitionCount).toBe(0);
    expect(reconciliationCount).toBe(1);
    await expect(ledger.get("withdrawal:recover")).resolves.toMatchObject({
      mediaCustody: "returned",
      operationId: "operation-before-crash",
      status: "abandoned",
    });
    expect(JSON.stringify(auditEvents)).toContain("operation-before-crash");
    expect(runtime.snapshot().operation.phase).toBe("idle");
  });

  it("uses a live compensation signal after operation interruption", async () => {
    let compensationWasAborted = true;
    const base = entry("card", []);
    const runtime = createKioskRuntime(
      options({
        entries: [
          {
            ...base,
            acquisition: {
              ...base.acquisition,
              acquire: async (ctx) => {
                await ctx.setMediaCustody("acquired");
                await waitForAbort(ctx.signal);
                return base.acquisition.acquire(ctx);
              },
            },
            mediaCustody: {
              kind: "physical",
              resolve: async (ctx) => {
                compensationWasAborted = ctx.compensationSignal.aborted;
                return { status: "returned" };
              },
            },
          },
        ],
      }),
    );
    await runtime.initialize();
    const running = runtime.start({ entryMethodId: "card", intentId: "compensate" });
    await waitUntil(() => runtime.snapshot().operation.mediaCustody === "acquired");

    await runtime.interrupt("route.exit");

    await expect(running).resolves.toMatchObject({ status: "interrupted" });
    expect(compensationWasAborted).toBe(false);
  });

  it("publishes readiness changes independently from operation state", async () => {
    const runtime = createKioskRuntime(
      options({
        capabilities: { "device.idc": "available" },
        entries: [{ ...entry("card", []), requiredCapabilities: ["device.idc"] }],
      }),
    );
    const statuses: string[] = [];
    runtime.subscribeReadiness((readiness) => statuses.push(readiness.status));
    await runtime.initialize();

    await runtime.refreshCapabilities({ "device.idc": "unavailable" });

    expect(statuses).toEqual(["failed", "ready", "failed"]);
  });

  it("presents a semantic prompt once across unrelated view revisions", async () => {
    const prompt = new MemoryPromptPresenter();
    const base = entry("card", []);
    const configured = options({ prompt });
    const runtime = createKioskRuntime({
      ...configured,
      entryMethods: [
        {
          ...base,
          acquisition: {
            ...base.acquisition,
            acquire: async (ctx) => {
              ctx.updateView({ promptId: "pin.enter" });
              ctx.updateView({ safeData: { waiting: true } });
              return base.acquisition.acquire(ctx);
            },
          },
        },
      ],
      promptIntent: (state) =>
        state.operationId && state.promptId
          ? {
              locale: "en",
              operationId: state.operationId,
              priority: "instruction",
              promptId: state.promptId,
              viewRevision: state.revision,
            }
          : undefined,
    });
    await runtime.initialize();

    await runtime.start({ entryMethodId: "card", intentId: "prompt-once" });

    expect(prompt.presented).toEqual(["pin.enter"]);
  });
});

interface OptionOverrides {
  readonly entries?: readonly EntryMethodContribution[];
  readonly challenges?: readonly AuthenticationChallengeContribution[];
  readonly capabilities?: Readonly<Record<string, "available" | "degraded" | "unavailable">>;
  readonly audit?: KioskRuntimeOptions["ports"]["audit"];
  readonly ledger?: InMemoryOperationLedger;
  readonly logger?: KioskRuntimeOptions["ports"]["logger"];
  readonly scopedStore?: MemoryScopedStore;
  readonly prompt?: PromptPresenterPort;
}

const options = (overrides: OptionOverrides = {}): KioskRuntimeOptions => ({
  authenticationChallenges: overrides.challenges ?? [],
  capabilities: overrides.capabilities ?? {},
  entryMethods: overrides.entries ?? [],
  mode: "memory",
  operationIdFactory: () => "operation-1",
  policy: {
    attemptBudgets: { validation: 2 },
    interactionTimeouts: { input: 1_000 },
    operationDeadlineMs: 10_000,
  },
  ports: {
    audit: overrides.audit,
    ledger: overrides.ledger ?? new InMemoryOperationLedger(),
    logger: overrides.logger,
    prompt: overrides.prompt,
    scopedStore: overrides.scopedStore ?? new MemoryScopedStore(),
    ui: new FrameworkUiPort({ navigate: () => {} }, new MemoryUiStateAdapter()),
  },
});

const entry = (
  id: string,
  requirements: readonly string[],
  wait: (done: () => void, signal: AbortSignal) => Promise<void> = async () => {},
): EntryMethodContribution => ({
  acquisition: {
    acquire: async (ctx) => {
      await wait(() => {}, ctx.signal);
      return {
        credential: { entryMethodId: id, id: `credential-${id}`, safeSummary: { acquired: true } },
        requirements: requirements.map((kind) => ({ kind })),
        riskBand: "standard",
      };
    },
    flow: { flowId: `${id}.acquire`, version: "1.0.0" },
  },
  availability: () => ({ available: true }),
  id,
  labelKey: `${id}.label`,
  mediaCustody: {
    kind: "none",
    resolve: async () => ({ status: "none" }),
  },
  version: "1.0.0",
});

const challenge = (id: string): AuthenticationChallengeContribution => ({
  execute: async () => ({ authenticated: true, safeSummary: { accepted: true } }),
  id,
  version: "1.0.0",
});

const waitForAbort = (signal: AbortSignal): Promise<void> =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  while (!predicate()) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

class MemoryPromptPresenter implements PromptPresenterPort {
  public cancelled: string[] = [];
  public presented: string[] = [];
  public async present(intent: Parameters<PromptPresenterPort["present"]>[0]) {
    this.presented.push(intent.promptId);
    return {
      cancel: async () => {},
      completed: Promise.resolve({ channel: "visual" as const, status: "visualOnly" as const }),
      id: `prompt-${this.presented.length}`,
    };
  }
  public async cancelOperation(operationId: string): Promise<void> {
    this.cancelled.push(operationId);
  }
  public async dispose(): Promise<void> {}
}

class MemoryLogger {
  public records: unknown[] = [];
  public trace(message: string, metadata: unknown): void {
    this.records.push({ message, metadata });
  }
  public debug(message: string, metadata: unknown): void {
    this.records.push({ message, metadata });
  }
  public info(message: string, metadata: unknown): void {
    this.records.push({ message, metadata });
  }
  public warn(message: string, metadata: unknown): void {
    this.records.push({ message, metadata });
  }
  public error(message: string, error: unknown, metadata: unknown): void {
    this.records.push({ error, message, metadata });
  }
  public child(): MemoryLogger {
    return this;
  }
}
