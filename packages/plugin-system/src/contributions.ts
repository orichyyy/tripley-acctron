import type { ConfigurationProvider } from "@tripley-kit/web-container-configuration";
import type { NativeExtensionAdapter } from "@tripley-kit/web-container-native-adapter";
import type { Migration } from "@tripley-kit/web-container-storage-core";
import { GenericExtensionRegistry } from "./extension-registry";
import type { OpenExtensionKind } from "./extension-registry";

export type PluginContributionValue = unknown;

export interface ServiceContribution {
  readonly id: OpenExtensionKind;
  readonly description?: string;
}

export interface RouteContribution {
  readonly id: OpenExtensionKind;
  readonly path: string;
  readonly component?: unknown;
  readonly layout?: OpenExtensionKind | undefined;
  readonly guards?: readonly OpenExtensionKind[] | undefined;
}

export interface LayoutContribution {
  readonly id: OpenExtensionKind;
  readonly component?: unknown;
}

export interface NavigationContribution {
  readonly id: OpenExtensionKind;
  readonly routeId: OpenExtensionKind;
  readonly label?: string;
  readonly commandId?: OpenExtensionKind | undefined;
  readonly area?: OpenExtensionKind | undefined;
  readonly order?: number | undefined;
  readonly visibleWhen?: OpenExtensionKind | readonly OpenExtensionKind[] | undefined;
  readonly enabledWhen?: OpenExtensionKind | readonly OpenExtensionKind[] | undefined;
}

export interface FlowContribution {
  readonly id: OpenExtensionKind;
  readonly definition?: unknown;
}

export interface FlowNodeHandlerContribution {
  readonly kind: OpenExtensionKind;
  readonly handler?: unknown;
}

export interface FlowNodeExecutorContribution {
  readonly kind: OpenExtensionKind;
  readonly executor?: unknown;
}

export interface EffectRunnerContribution {
  readonly kind: OpenExtensionKind;
  readonly runner?: unknown;
}

export interface CommandContribution {
  readonly id: OpenExtensionKind;
  readonly command?: unknown;
}

export interface CommandMiddlewareContribution {
  readonly id: OpenExtensionKind;
  readonly middleware?: unknown;
}

export interface ConditionContribution {
  readonly id: OpenExtensionKind;
  readonly condition?: unknown;
}

export interface ValidatorContribution {
  readonly id: OpenExtensionKind;
  readonly validator?: unknown;
}

export interface DeviceContribution {
  readonly type: OpenExtensionKind;
  readonly adapter?: unknown;
}

export interface InputSourceContribution {
  readonly kind: OpenExtensionKind;
  readonly adapter?: unknown;
  readonly dataClassification?: OpenExtensionKind;
}

export interface ConfigurationProviderContribution {
  readonly id: OpenExtensionKind;
  readonly provider?: ConfigurationProvider;
}

export interface ConfigSchemaContribution {
  readonly id: OpenExtensionKind;
  readonly schema?: unknown;
}

export interface MigrationContribution {
  readonly id: OpenExtensionKind;
  readonly migration?: Migration;
}

export interface RepositoryContribution {
  readonly id: OpenExtensionKind;
  readonly repository?: unknown;
}

export interface HealthCheckContribution {
  readonly id: OpenExtensionKind;
  readonly check?: unknown;
}

export interface NativeExtensionContribution {
  readonly id: OpenExtensionKind;
  readonly adapter?: NativeExtensionAdapter;
}

export interface LogEnricherContribution {
  readonly id: OpenExtensionKind;
  readonly enricher?: unknown;
}

export interface FrameworkExtensionRegistry {
  readonly inputSources: GenericExtensionRegistry<InputSourceContribution>;
  readonly devices: GenericExtensionRegistry<DeviceContribution>;
  readonly flowNodeHandlers: GenericExtensionRegistry<FlowNodeHandlerContribution>;
  readonly flowNodeExecutors: GenericExtensionRegistry<FlowNodeExecutorContribution>;
  readonly effectRunners: GenericExtensionRegistry<EffectRunnerContribution>;
  readonly commands: GenericExtensionRegistry<CommandContribution>;
  readonly commandMiddleware: GenericExtensionRegistry<CommandMiddlewareContribution>;
  readonly conditions: GenericExtensionRegistry<ConditionContribution>;
  readonly validators: GenericExtensionRegistry<ValidatorContribution>;
  readonly configProviders: GenericExtensionRegistry<ConfigurationProviderContribution>;
  readonly configSchema: GenericExtensionRegistry<ConfigSchemaContribution>;
  readonly repositories: GenericExtensionRegistry<RepositoryContribution>;
  readonly migrations: GenericExtensionRegistry<MigrationContribution>;
  readonly logEnrichers: GenericExtensionRegistry<LogEnricherContribution>;
  readonly routes: GenericExtensionRegistry<RouteContribution>;
  readonly layouts: GenericExtensionRegistry<LayoutContribution>;
  readonly navigation: GenericExtensionRegistry<NavigationContribution>;
  readonly services: GenericExtensionRegistry<ServiceContribution>;
  readonly healthChecks: GenericExtensionRegistry<HealthCheckContribution>;
  readonly nativeExtensions: GenericExtensionRegistry<NativeExtensionContribution>;
  readonly flows: GenericExtensionRegistry<FlowContribution>;
  disposeOwner(ownerPluginId: string): Promise<void>;
}

export const createFrameworkExtensionRegistry = (): FrameworkExtensionRegistry => {
  const registries = {
    commandMiddleware: new GenericExtensionRegistry<CommandMiddlewareContribution>(
      "commandMiddleware",
    ),
    commands: new GenericExtensionRegistry<CommandContribution>("commands"),
    conditions: new GenericExtensionRegistry<ConditionContribution>("conditions"),
    configProviders: new GenericExtensionRegistry<ConfigurationProviderContribution>(
      "configProviders",
    ),
    configSchema: new GenericExtensionRegistry<ConfigSchemaContribution>("configSchema"),
    devices: new GenericExtensionRegistry<DeviceContribution>("devices"),
    effectRunners: new GenericExtensionRegistry<EffectRunnerContribution>("effectRunners"),
    flowNodeExecutors: new GenericExtensionRegistry<FlowNodeExecutorContribution>(
      "flowNodeExecutors",
    ),
    flowNodeHandlers: new GenericExtensionRegistry<FlowNodeHandlerContribution>("flowNodeHandlers"),
    flows: new GenericExtensionRegistry<FlowContribution>("flows"),
    healthChecks: new GenericExtensionRegistry<HealthCheckContribution>("healthChecks"),
    inputSources: new GenericExtensionRegistry<InputSourceContribution>("inputSources"),
    layouts: new GenericExtensionRegistry<LayoutContribution>("layouts"),
    logEnrichers: new GenericExtensionRegistry<LogEnricherContribution>("logEnrichers"),
    migrations: new GenericExtensionRegistry<MigrationContribution>("migrations"),
    nativeExtensions: new GenericExtensionRegistry<NativeExtensionContribution>("nativeExtensions"),
    navigation: new GenericExtensionRegistry<NavigationContribution>("navigation"),
    repositories: new GenericExtensionRegistry<RepositoryContribution>("repositories"),
    routes: new GenericExtensionRegistry<RouteContribution>("routes"),
    services: new GenericExtensionRegistry<ServiceContribution>("services"),
    validators: new GenericExtensionRegistry<ValidatorContribution>("validators"),
  };

  return {
    ...registries,
    disposeOwner: async (ownerPluginId: string) => {
      await Promise.all(
        Object.values(registries).map((registry) => registry.disposeOwner(ownerPluginId)),
      );
    },
  };
};
