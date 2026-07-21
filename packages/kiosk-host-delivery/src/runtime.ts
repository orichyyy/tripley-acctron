import type { FrameworkSqliteConnection } from "@tripley-kit/web-container-storage-core";

import type {
  HostDeliveryClock,
  HostInquiryPort,
  HostPayloadCipherPort,
  HostTransportPort,
} from "./contracts";
import { systemHostDeliveryClock } from "./contracts";
import { SqliteEncryptedHostPayloadVault } from "./payload-vault";
import { HostDeliveryPolicyRegistry } from "./policy";
import { HostDeliveryQueue } from "./queue";
import {
  HostResponseReconciliationService,
  HostUncertainReconciliationService,
  ManualHostReconciliationService,
} from "./reconciliation";
import { SqliteHostReconciliationStore } from "./sqlite-reconciliation";
import { SqliteHostDeliveryStore } from "./sqlite-store";
import { HostDeliveryWorker } from "./worker";

export interface HostDeliveryRuntimeOptions {
  readonly db: FrameworkSqliteConnection;
  readonly ownerId: string;
  readonly cipher: HostPayloadCipherPort;
  readonly policies: HostDeliveryPolicyRegistry;
  readonly transport: HostTransportPort;
  readonly inquiry: HostInquiryPort;
  readonly clock?: HostDeliveryClock | undefined;
}

export const createHostDeliveryRuntime = (options: HostDeliveryRuntimeOptions) => {
  options.policies.freeze();
  const clock = options.clock ?? systemHostDeliveryClock;
  const deliveries = new SqliteHostDeliveryStore(options.db, clock);
  const vault = new SqliteEncryptedHostPayloadVault(options.db, options.cipher, clock);
  const responseStore = new SqliteHostReconciliationStore(options.db, clock);
  const responses = new HostResponseReconciliationService(responseStore, vault);
  return {
    deliveries,
    manual: new ManualHostReconciliationService(responseStore, clock),
    queue: new HostDeliveryQueue(deliveries, vault, options.policies),
    reconciliation: new HostUncertainReconciliationService(
      deliveries,
      responses,
      options.policies,
      options.inquiry,
      clock,
    ),
    responses,
    vault,
    worker: new HostDeliveryWorker(
      options.ownerId,
      deliveries,
      vault,
      options.policies,
      options.transport,
      responses,
      clock,
    ),
  };
};
