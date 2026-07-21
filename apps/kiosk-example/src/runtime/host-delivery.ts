import {
  createHostDeliveryRuntime,
  HostDeliveryPolicyRegistry,
  hostDeliveryMigration,
  type HostDeliveryRuntimeOptions,
} from "@tripley-kit/web-container-kiosk-host-delivery";

export const createExampleHostDeliveryPolicies = () => new HostDeliveryPolicyRegistry()
  .register({
    id: "acctron.host.authorization",
    inquiryNotFound: "manual",
    leaseMs: 15_000,
    maxAttempts: 3,
    retryDelaysMs: [1_000, 5_000, 30_000],
    uncertainStrategy: "inquiry",
    version: "1",
  })
  .register({
    id: "acctron.host.financial-completion",
    inquiryNotFound: "retry",
    leaseMs: 15_000,
    maxAttempts: 5,
    retryDelaysMs: [1_000, 5_000, 30_000, 60_000],
    uncertainStrategy: "inquiry",
    version: "1",
  });

export const exampleHostDeliveryMigration = hostDeliveryMigration;

export const createExampleHostDeliveryRuntime = (
  options: Omit<HostDeliveryRuntimeOptions, "policies">,
) => createHostDeliveryRuntime({
  ...options,
  policies: createExampleHostDeliveryPolicies(),
});
