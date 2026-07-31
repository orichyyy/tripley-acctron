import { describe, expect, it } from "vitest";
import type { XfsCommandLease, XfsCommandLeaseRequest } from "@tripley-kit/xfs-client";

import type { XfsCardReaderPort } from "./ports";
import type {
  CardCustodyEvidence,
  CardCustodyLeasePort,
  CardCustodyPolicy,
} from "./card-custody-contracts";
import { XfsCardCustodyLeaseAdapter } from "./card-custody-lease-adapter";
import { CardCustodyPolicyRegistry } from "./card-custody-policy";
import { CardCustodyService, cardCustodyAllowsCashPresentation } from "./card-custody";
import type { XfsCardMediaState } from "./types";

describe("CardCustodyService", () => {
  it("returns a taken card with fenced authority and safe evidence", async () => {
    const fixture = createFixture();
    fixture.card.waitResult = { state: "notPresent", taken: true };

    const outcome = await fixture.service.returnCard(request());

    expect(outcome).toMatchObject({
      authority: { fencingToken: 41, hostEpoch: "host-7" },
      authorityReleased: true,
      reason: "taken",
      status: "returned",
    });
    expect(cardCustodyAllowsCashPresentation(outcome)).toBe(true);
    expect(fixture.card.ejectCalls).toBe(1);
    expect(fixture.lease.authorities).toEqual(["recovery"]);
    expect(fixture.lease.releases).toBe(1);
    expect(fixture.lease.acknowledgements).toBe(1);
    expect(fixture.evidence.map((entry) => entry.action)).toEqual([
      "authority-acquired",
      "eject-requested",
      "eject-completed",
      "media-observed",
      "terminal",
      "authority-released",
    ]);
    expect(JSON.stringify(fixture.evidence)).not.toContain("4761739001010010");
  });

  it("retains a card after the customer take timeout", async () => {
    const fixture = createFixture();
    fixture.card.waitResult = { state: "presented", taken: false };

    const outcome = await fixture.service.returnCard(request());

    expect(outcome).toMatchObject({ reason: "take-timeout", status: "retained" });
    expect(fixture.card.retainCalls).toBe(1);
    expect(fixture.lease.acknowledgements).toBe(1);
    expect(cardCustodyAllowsCashPresentation(outcome)).toBe(false);
  });

  it("continues with transaction authority acquired before card read", async () => {
    const fixture = createFixture();
    const authority = await fixture.lease.acquire({
      authority: "transaction",
      logicalService: "IDC1",
      operationId: "withdrawal-42",
      resourceGroup: "card:IDC1",
    });

    const outcome = await fixture.service.returnCard({ ...request(), authority });

    expect(outcome).toMatchObject({ authorityReleased: true, status: "returned" });
    expect(fixture.lease.acquisitions).toBe(1);
  });

  it("retains an ejected card when node exit interrupts the wait", async () => {
    const abort = new AbortController();
    const fixture = createFixture({ interruptActions: { "node-exit": "retain" } });
    fixture.card.wait = async (_options, context) => {
      abort.abort("route.exit");
      context?.signal?.throwIfAborted();
      throw new Error("unreachable");
    };

    const outcome = await fixture.service.returnCard({
      ...request(),
      interruptReason: "node-exit",
      signal: abort.signal,
    });

    expect(outcome).toMatchObject({ reason: "node-exit", status: "retained" });
    expect(fixture.card.retainCalls).toBe(1);
  });

  it("reports eject failure precisely and blocks cash presentation", async () => {
    const fixture = createFixture();
    fixture.card.ejectError = Object.assign(new Error("sensitive vendor detail"), {
      code: "xfs.idc.eject.failed",
    });

    const outcome = await fixture.service.returnCard(request());

    expect(outcome).toMatchObject({
      failureCode: "xfs.idc.eject.failed",
      reason: "eject-failed",
      status: "intervention",
    });
    expect(JSON.stringify(outcome)).not.toContain("sensitive vendor detail");
    expect(cardCustodyAllowsCashPresentation(outcome)).toBe(false);
    expect(fixture.lease.acknowledgements).toBe(0);
  });

  it("rejects stale authority before issuing a device command", async () => {
    const fixture = createFixture();
    fixture.lease.reject = Object.assign(new Error("stale owner details"), {
      code: "xfs.commandLease.staleOwner",
    });

    const outcome = await fixture.service.returnCard(request());

    expect(outcome).toMatchObject({
      failureCode: "xfs.commandLease.staleOwner",
      reason: "authority-rejected",
      status: "intervention",
    });
    expect(fixture.card.ejectCalls).toBe(0);
  });

  it("does not infer taken versus retained when recovery observes no card", async () => {
    const fixture = createFixture();
    fixture.card.mediaState = "notPresent";

    const outcome = await fixture.service.reconcile({ operationId: "withdrawal-42" });

    expect(outcome).toMatchObject({ reason: "custody-unknown", status: "intervention" });
  });

  it("supports a project policy that leaves timed-out media presented", async () => {
    const fixture = createFixture({ takeTimeoutAction: "leave-presented" });
    fixture.card.waitResult = { state: "presented", taken: false };

    const outcome = await fixture.service.returnCard(request());

    expect(outcome).toMatchObject({ mediaState: "presented", status: "presented" });
    expect(fixture.card.retainCalls).toBe(0);
  });
});

describe("XfsCardCustodyLeaseAdapter", () => {
  it("binds host epoch, fencing token, resource group, and owner", async () => {
    let acquisition: Record<string, unknown> | undefined;
    const lifecycle: string[] = [];
    let acknowledgement: Record<string, unknown> | undefined;
    const commandLeases = {
      acknowledgeProtection: async (input: Record<string, unknown>) => {
        lifecycle.push("acknowledge");
        acknowledgement = input;
      },
      acquireNext: async (
        input: Omit<XfsCommandLeaseRequest, "fencingToken">,
      ): Promise<XfsCommandLease> => {
        acquisition = { ...input };
        return {
          ...input,
          connectionGeneration: 1,
          configHash: "config",
          expiresInMs: 1_000,
          fencingToken: 77,
          ownerInstanceId: input.ownerInstanceId ?? "",
          protectionPolicyProfileHash: "",
          protectionPolicyProfileId: "",
          protectionPolicyProfileVersion: "",
          reconnectProof: "proof",
          resourceGroup: input.resourceGroup ?? "",
          state: "active" as const,
        };
      },
      getHostEpoch: async () => "epoch-9",
      release: async () => { lifecycle.push("release"); },
      transition: async () => {
        throw new Error("unused");
      },
    };
    const adapter = new XfsCardCustodyLeaseAdapter({
      commandLeases,
      ownerInstanceId: "kiosk-a",
    });

    const lease = await adapter.acquire({
      authority: "transaction",
      logicalService: "IDC1",
      operationId: "operation-1",
      resourceGroup: "card:IDC1",
    });

    expect(acquisition).toMatchObject({
      hostEpoch: "epoch-9",
      ownerInstanceId: "kiosk-a",
      resourceGroup: "card:IDC1",
    });
    expect(lease.fencingToken).toBe(77);
    await expect(lease.release({ acknowledgeProtection: true })).resolves.toBeUndefined();
    expect(lifecycle).toEqual(["release", "acknowledge"]);
    expect(acknowledgement).toEqual({
      hostEpoch: "epoch-9",
      operationId: "operation-1",
      resourceGroup: "card:IDC1",
    });
  });
});

const request = () => ({ operationId: "withdrawal-42", policyId: "bank.return-card" });

const createFixture = (overrides: Partial<CardCustodyPolicy> = {}) => {
  const evidence: CardCustodyEvidence[] = [];
  const card = new FakeCardPort();
  const lease = new FakeLeasePort();
  const policies = new CardCustodyPolicyRegistry().register({
    id: "bank.return-card",
    pollIntervalMs: 10,
    takeTimeoutAction: "retain",
    takeTimeoutMs: 1_000,
    version: "1",
    ...overrides,
  });
  return {
    card,
    evidence,
    lease,
    service: new CardCustodyService({
      card,
      evidence: { append: async (entry) => { evidence.push(entry); } },
      leases: lease,
      logicalService: "IDC1",
      now: () => new Date("2026-07-20T00:00:00.000Z"),
      policies,
    }),
  };
};

class FakeCardPort implements XfsCardReaderPort {
  public ejectCalls = 0;
  public retainCalls = 0;
  public ejectError: unknown;
  public mediaState: XfsCardMediaState = "inside";
  public waitResult = { state: "notPresent" as XfsCardMediaState, taken: true };
  public wait: XfsCardReaderPort["waitForTaken"] = async () => this.takenResult();

  public async readCard(): Promise<never> { throw new Error("unused"); }
  public async ejectCard(): Promise<void> {
    this.ejectCalls += 1;
    if (this.ejectError) throw this.ejectError;
    this.mediaState = "presented";
  }
  public async retainCard(): Promise<void> {
    this.retainCalls += 1;
    this.mediaState = "notPresent";
  }
  public async getMediaStatus() {
    return { safeSummary: { mediaState: this.mediaState }, state: this.mediaState };
  }
  public async waitForTaken(...args: Parameters<XfsCardReaderPort["waitForTaken"]>) {
    return this.wait(...args);
  }
  public async cancel(): Promise<void> {}
  private takenResult() {
    return {
      safeSummary: { taken: this.waitResult.taken },
      status: { safeSummary: { mediaState: this.waitResult.state }, state: this.waitResult.state },
      taken: this.waitResult.taken,
    };
  }
}

class FakeLeasePort implements CardCustodyLeasePort {
  public acknowledgements = 0;
  public acquisitions = 0;
  public authorities: string[] = [];
  public reject: unknown;
  public releases = 0;

  public async acquire(request: Parameters<CardCustodyLeasePort["acquire"]>[0]) {
    this.acquisitions += 1;
    this.authorities.push(request.authority);
    if (this.reject) throw this.reject;
    return {
      authority: request.authority,
      fencingToken: 41,
      hostEpoch: "host-7",
      release: async (options?: { readonly acknowledgeProtection?: boolean }) => {
        this.releases += 1;
        if (options?.acknowledgeProtection) this.acknowledgements += 1;
      },
      transitionToRecovery: async () => undefined,
    };
  }
}
