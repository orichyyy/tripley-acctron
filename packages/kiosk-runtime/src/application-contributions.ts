import type {
  Command,
  CommandMiddleware,
  CommandRegistry,
} from "@tripley-kit/web-container-command-system";
import type {
  Condition,
  ConditionRegistry,
} from "@tripley-kit/web-container-condition-engine";
import type {
  InputSourceAdapter,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";
import type {
  EffectRunner,
  FlowDefinition,
  FlowNodeExecutor,
} from "@tripley-kit/web-container-flow-engine";
import type { ExecutableFlowEngine } from "@tripley-kit/web-container-flow-engine";
import type {
  HealthCheck,
  HealthCheckCenter,
} from "@tripley-kit/web-container-kiosk-base";
import type { FrameworkExtensionRegistry } from "@tripley-kit/web-container-plugin-system";
import type {
  PromptDefinition,
  PromptDefinitionCatalog,
} from "@tripley-kit/web-container-prompt-presentation";
import type {
  LayoutContribution,
  LayoutContributionRegistry,
  MenuContributionRegistry,
  NavigationContribution,
  RouteContribution,
  RouteContributionRegistry,
} from "@tripley-kit/web-container-ui-port";

export interface ApplicationContributionTargets {
  readonly commands: CommandRegistry;
  readonly conditions: ConditionRegistry;
  readonly flowEngine: ExecutableFlowEngine;
  readonly healthChecks: HealthCheckCenter;
  readonly inputSources: InputSourceRegistry;
  readonly layouts: LayoutContributionRegistry;
  readonly navigation: MenuContributionRegistry;
  readonly prompts: PromptDefinitionCatalog;
  readonly routes: RouteContributionRegistry;
}

export const bindApplicationContributions = (
  extensions: FrameworkExtensionRegistry,
  targets: ApplicationContributionTargets,
): void => {
  bindCommands(extensions, targets);
  bindConditions(extensions, targets);
  bindFlows(extensions, targets);
  bindInputSources(extensions, targets);
  bindHealthChecks(extensions, targets);
  bindPrompts(extensions, targets);
  bindUi(extensions, targets);
};

const bindPrompts = (
  extensions: FrameworkExtensionRegistry,
  targets: ApplicationContributionTargets,
): void => {
  for (const registration of extensions.prompts.list()) {
    const definition = requireIdentity<PromptDefinition>(
      registration.value.definition,
      "id",
      registration.id,
      "prompt",
    );
    targets.prompts.register(definition);
  }
};

const bindCommands = (
  extensions: FrameworkExtensionRegistry,
  targets: ApplicationContributionTargets,
): void => {
  for (const registration of extensions.commandMiddleware.list()) {
    const middleware = requireIdentity<CommandMiddleware>(
      registration.value.middleware,
      "id",
      registration.id,
      "command middleware",
    );
    targets.commands.registerMiddleware(middleware);
  }
  for (const registration of extensions.commands.list()) {
    const command = requireIdentity<Command>(
      registration.value.command,
      "id",
      registration.id,
      "command",
    );
    targets.commands.register(command);
  }
};

const bindConditions = (
  extensions: FrameworkExtensionRegistry,
  targets: ApplicationContributionTargets,
): void => {
  for (const registration of extensions.conditions.list()) {
    const condition = requireIdentity<Condition>(
      registration.value.condition,
      "id",
      registration.id,
      "condition",
    );
    targets.conditions.register(condition, {
      ownerPluginId: registration.ownerPluginId,
    });
  }
};

const bindFlows = (
  extensions: FrameworkExtensionRegistry,
  targets: ApplicationContributionTargets,
): void => {
  for (const registration of extensions.flowNodeExecutors.list()) {
    const executor = requireIdentity<FlowNodeExecutor>(
      registration.value.executor,
      "kind",
      registration.id,
      "flow node executor",
    );
    targets.flowEngine.nodeExecutors.registerExecutor({
      id: registration.id,
      ownerPluginId: registration.ownerPluginId,
      priority: registration.priority,
      value: executor,
      version: registration.version,
    });
  }
  for (const registration of extensions.effectRunners.list()) {
    const runner = requireIdentity<EffectRunner>(
      registration.value.runner,
      "kind",
      registration.id,
      "effect runner",
    );
    targets.flowEngine.effectRunners.registerRunner({
      id: registration.id,
      ownerPluginId: registration.ownerPluginId,
      priority: registration.priority,
      value: runner,
      version: registration.version,
    });
  }
  for (const registration of extensions.flows.list()) {
    const definition = requireIdentity<FlowDefinition>(
      registration.value.definition,
      "id",
      registration.id,
      "flow",
    );
    targets.flowEngine.register(definition);
  }
};

const bindInputSources = (
  extensions: FrameworkExtensionRegistry,
  targets: ApplicationContributionTargets,
): void => {
  for (const registration of extensions.inputSources.list()) {
    const adapter = requireIdentity<InputSourceAdapter>(
      registration.value.adapter,
      "kind",
      registration.id,
      "input source",
    );
    targets.inputSources.register({
      id: registration.id,
      ownerPluginId: registration.ownerPluginId,
      priority: registration.priority,
      value: adapter,
      version: registration.version,
    });
  }
};

const bindHealthChecks = (
  extensions: FrameworkExtensionRegistry,
  targets: ApplicationContributionTargets,
): void => {
  for (const registration of extensions.healthChecks.list()) {
    targets.healthChecks.register(
      requireIdentity<HealthCheck>(
        registration.value.check,
        "id",
        registration.id,
        "health check",
      ),
    );
  }
};

const bindUi = (
  extensions: FrameworkExtensionRegistry,
  targets: ApplicationContributionTargets,
): void => {
  const routePaths = new Map<string, string>();
  for (const registration of extensions.routes.list()) {
    const contribution = registration.value;
    if (contribution.component === undefined) {
      throw invalidContribution("route", registration.id, "component is required");
    }
    const route: RouteContribution = {
      component: contribution.component,
      guards: contribution.guards,
      id: contribution.id,
      layout: contribution.layout,
      ownerPluginId: registration.ownerPluginId,
      path: contribution.path,
    };
    routePaths.set(route.id, route.path);
    targets.routes.register(route);
  }
  for (const registration of extensions.layouts.list()) {
    if (registration.value.component === undefined) {
      throw invalidContribution("layout", registration.id, "component is required");
    }
    const layout: LayoutContribution = {
      component: registration.value.component,
      id: registration.value.id,
      ownerPluginId: registration.ownerPluginId,
    };
    targets.layouts.register(layout);
  }
  for (const registration of extensions.navigation.list()) {
    const contribution = registration.value;
    const path = routePaths.get(contribution.routeId);
    if (!path) {
      throw invalidContribution(
        "navigation",
        registration.id,
        `route is missing: ${contribution.routeId}`,
      );
    }
    const navigation: NavigationContribution = {
      area: contribution.area,
      commandId: contribution.commandId,
      enabledWhen: contribution.enabledWhen,
      id: contribution.id,
      label: contribution.label ?? contribution.id,
      order: contribution.order,
      ownerPluginId: registration.ownerPluginId,
      path,
      visibleWhen: contribution.visibleWhen,
    };
    targets.navigation.register(navigation);
  }
};

const requireIdentity = <TValue>(
  value: unknown,
  identityKey: "id" | "kind",
  expected: string,
  contributionKind: string,
): TValue => {
  if (!value || typeof value !== "object") {
    throw invalidContribution(contributionKind, expected, "implementation is required");
  }
  const identity = (value as Record<string, unknown>)[identityKey];
  if (identity !== expected) {
    throw invalidContribution(
      contributionKind,
      expected,
      `${identityKey} must match the contribution identity`,
    );
  }
  return value as TValue;
};

const invalidContribution = (
  kind: string,
  id: string,
  reason: string,
): FrameworkError =>
  new FrameworkError({
    category: "configuration",
    code: "kiosk.application.contribution.invalid",
    message: `Invalid ${kind} contribution: ${id}`,
    metadata: { contributionId: id, contributionKind: kind, reason },
  });
