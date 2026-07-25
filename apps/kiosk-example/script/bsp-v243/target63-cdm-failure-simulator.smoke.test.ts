import { DeviceRegistry } from "@tripley-kit/web-container-device-core";
import {
  CashPresentationAuthorizer,
  CashPresentationGateRegistry,
  type CashDeliveryPort,
  type CashPresentationPolicy,
} from "@tripley-kit/web-container-xfs-device-service";
import {
  prepareHostdCdmSimulator,
  withHostdXfsCommandFailure,
  xfsHostdTestConfigFromEnv,
} from "@tripley-kit/web-container-xfs-test-harness";
import {
  createTripleyKitXfsRuntimeClient,
  createXfsDeviceService,
} from "@tripley-kit/web-container-xfs-device-service";
import { describe, expect, it } from "vitest";

import { safeTarget62Error } from "./target62-smoke-support";
import { createTarget63CashEvidence } from "./target63-smoke-support";

const smoke = process.env.TARGET63_SIMULATOR_SMOKE === "1" ? it : it.skip;
const CDM_DISPENSE = 302;
const WFS_ERR_CDM_NOITEMS = -316;

describe("Target 63 CDM failure simulator smoke", () => {
  smoke("proves untaken-cash retraction and injected dispense failure", async () => {
    expect(process.env.TARGET63_SIMULATOR_CONFIRM).toBe(
      "I_UNDERSTAND_SIMULATOR_ONLY",
    );
    const url =
      process.env.TRIPLEY_NATIVE_HOSTD_URL ?? "ws://127.0.0.1:39010";
    const config = xfsHostdTestConfigFromEnv({
      ...process.env,
      TRIPLEY_NATIVE_HOSTD_URL: url,
    });
    const cdm = await prepareHostdCdmSimulator({
      currencyId: "TWD",
      denomination: 100,
      profileName: "tripley-acctron-target63-twd",
      url,
    });
    const collected = createTarget63CashEvidence();
    const devices = new DeviceRegistry();
    const client = createTripleyKitXfsRuntimeClient({
      authToken: config.authToken,
      requiredModules: ["manager", "cdm"],
      url,
    });
    const service = createXfsDeviceService({
      logicalServices: [{
        capabilities: ["cash.dispense", "cash.present", "cash.retract"],
        cdm: {
          configurationRevision: "target63-smoke",
          policyVersion: "1",
          protectionPolicyProfileId: config.protectionProfileId,
          resourceGroup:
            process.env.TARGET63_CDM_RESOURCE_GROUP ?? "cash-transport-1",
          statusPollMs: 50,
          tellerId: cdm.tellerId,
        },
        deviceId: "cashDispenser",
        logicalName: cdm.logicalName,
        module: "cdm",
      }],
      url,
    }, {
      cash: collected.dependencies,
      client,
    });

    try {
      await client.connect();
      await service.connect();
      service.registerDevices(devices);
      const cash = devices.require<CashDeliveryPort>("cashDispenser");

      const untaken = await cash.start(request("target63-cash-not-taken"));
      await untaken.session.dispense(untaken.plan);
      const authorization = await new CashPresentationAuthorizer(
        new CashPresentationGateRegistry(),
      ).authorize({
        cashSessionId: untaken.session.id,
        operationId: "target63-cash-not-taken",
        policy: presentationPolicy,
      });
      await untaken.session.present(authorization);
      const terminal = await untaken.session.waitForTake();

      expect(terminal).toMatchObject({
        outcome: "retracted",
        reconciliationRequired: false,
      });
      expect(collected.evidence.events.map(({ kind }) => kind)).toContain(
        "cash.take.timeout",
      );
      expect(collected.evidence.snapshots.map(({ boundary }) => boundary))
        .toEqual(expect.arrayContaining(["before", "after"]));
      expect(collected.evidence.ejProjections).toHaveLength(1);

      let dispenseError: unknown;
      await withHostdXfsCommandFailure({
        authToken: config.authToken,
        command: CDM_DISPENSE,
        hresult: WFS_ERR_CDM_NOITEMS,
        logicalName: cdm.logicalName,
        url,
      }, async () => {
        const failed = await cash.start(request("target63-dispense-failed"));
        try {
          await failed.session.dispense(failed.plan);
        } catch (error) {
          dispenseError = error;
        } finally {
          if (!failed.session.isTerminal) {
            await failed.session.abort("interrupt").catch(() => undefined);
          }
        }
      });
      expect(dispenseError).toBeInstanceOf(Error);

      process.stdout.write(`${JSON.stringify({
        cashNotTaken: {
          custody: terminal.outcome,
          presented: true,
          retracted: terminal.outcome === "retracted",
        },
        dispenseFailed: safeTarget62Error(dispenseError),
        event: "target63.withdrawal-failures.passed",
        logicalService: cdm.logicalName,
        snapshotBoundaries: collected.evidence.snapshots.map(
          ({ boundary }) => boundary,
        ),
      })}\n`);
    } finally {
      await Promise.allSettled([service.dispose(), client.dispose()]);
    }
  }, 90_000);
});

const presentationPolicy: CashPresentationPolicy = {
  authorizationTtlMs: 5_000,
  id: "target63.cash.present",
  requiredGates: [],
  takeTimeoutMs: 500,
  version: "1",
};

function request(operationId: string) {
  return {
    amount: {
      currency: "TWD",
      minorUnits: Number(process.env.TARGET63_WITHDRAWAL_MINOR_UNITS ?? 10_000),
    },
    operationId,
    ownerInstanceId: "target63-simulator",
    presentationPolicy,
  };
}
