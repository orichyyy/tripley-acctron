import { describe, expect, it } from "vitest";
import { prepareHostdCdmSimulator } from "./cdm-smoke";

describe("hostd-backed CDM simulator", () => {
  it("resolves required CDM modules, command leasing, and simulator profile automation", async () => {
    const logicalName = process.env.TRIPLEY_XFS_CDM_LOGICAL_NAME;
    const url = process.env.TRIPLEY_XFS_HOSTD_URL;
    const profileName = process.env.TRIPLEY_XFS_CDM_PROFILE;
    const summary = await prepareHostdCdmSimulator({
      ...(logicalName !== undefined ? { logicalName } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(profileName !== undefined ? { profileName } : {}),
    });

    if (logicalName !== undefined) {
      expect(summary.logicalName).toBe(logicalName);
    } else {
      expect(summary.logicalName.length).toBeGreaterThan(0);
    }
    expect(summary.profileName.length).toBeGreaterThan(0);
    expect(summary.cashUnitCount).toBeGreaterThan(0);
    expect(summary.hostEpoch.length).toBeGreaterThan(0);
  });
});
