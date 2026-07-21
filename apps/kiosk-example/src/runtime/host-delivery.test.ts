import { describe, expect, it } from "vitest";

import { createExampleHostDeliveryPolicies } from "./host-delivery";

describe("example host delivery policies", () => {
  it("uses manual authorization reconciliation but permits completion retry after inquiry", () => {
    const policies = createExampleHostDeliveryPolicies();

    expect(policies.require("acctron.host.authorization")).toMatchObject({
      inquiryNotFound: "manual",
      uncertainStrategy: "inquiry",
    });
    expect(policies.require("acctron.host.financial-completion")).toMatchObject({
      inquiryNotFound: "retry",
      uncertainStrategy: "inquiry",
    });
  });
});
