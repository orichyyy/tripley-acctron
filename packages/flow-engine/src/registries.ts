import {
  type ExtensionRegistration,
  GenericExtensionRegistry,
} from "@tripley-kit/web-container-device-core";
import type {
  EffectRunner,
  FlowNodeExecutor,
  FlowNodeKind,
  FlowPolicy,
  FlowPolicyKind,
} from "./types";

export class FlowNodeExecutorRegistry extends GenericExtensionRegistry<FlowNodeExecutor> {
  public constructor() {
    super("flowNodeExecutors");
  }

  public registerExecutor(
    executorOrRegistration: FlowNodeExecutor | ExtensionRegistration<FlowNodeExecutor>,
  ): void {
    if ("value" in executorOrRegistration) {
      this.register(executorOrRegistration);
      return;
    }

    this.register({ id: executorOrRegistration.kind, value: executorOrRegistration });
  }

  public requireExecutor(kind: FlowNodeKind): FlowNodeExecutor {
    return this.require(kind);
  }
}

export class EffectRunnerRegistry extends GenericExtensionRegistry<EffectRunner> {
  public constructor() {
    super("effectRunners");
  }

  public registerRunner(
    runnerOrRegistration: EffectRunner | ExtensionRegistration<EffectRunner>,
  ): void {
    if ("value" in runnerOrRegistration) {
      this.register(runnerOrRegistration);
      return;
    }

    this.register({ id: runnerOrRegistration.kind, value: runnerOrRegistration });
  }
}

export class FlowPolicyRegistry extends GenericExtensionRegistry<FlowPolicy> {
  public constructor() {
    super("flowPolicies");
  }

  public registerPolicy(
    policyOrRegistration: FlowPolicy | ExtensionRegistration<FlowPolicy>,
  ): void {
    if ("value" in policyOrRegistration) {
      this.register(policyOrRegistration);
      return;
    }

    this.register({ id: policyOrRegistration.kind, value: policyOrRegistration });
  }

  public requirePolicy(kind: FlowPolicyKind): FlowPolicy {
    return this.require(kind);
  }
}
