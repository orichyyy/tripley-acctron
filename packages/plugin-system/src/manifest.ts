import type {
  CommandContribution,
  CommandMiddlewareContribution,
  ConditionContribution,
  ConfigSchemaContribution,
  ConfigurationProviderContribution,
  DeviceContribution,
  EffectRunnerContribution,
  FlowContribution,
  FlowNodeExecutorContribution,
  FlowNodeHandlerContribution,
  HealthCheckContribution,
  InputSourceContribution,
  LayoutContribution,
  MigrationContribution,
  NativeExtensionContribution,
  NavigationContribution,
  PromptContribution,
  RepositoryContribution,
  RouteContribution,
  ServiceContribution,
  ValidatorContribution,
} from "./contributions";

export type PluginType =
  | "service"
  | "ui"
  | "flow"
  | "native-adapter"
  | "project-preset"
  | "device"
  | "storage"
  | "condition"
  | "command"
  | (string & {});

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: readonly PluginType[];
  readonly optional?: boolean | undefined;
  readonly compatibility?: PluginCompatibility | undefined;
  readonly dependencies?: PluginDependencies | undefined;
  readonly permissions?: PluginPermissions | undefined;
  readonly contributes?: PluginContributions | undefined;
}

export interface PluginCompatibility {
  readonly frameworkVersion?: string | undefined;
  readonly projectBase?: readonly string[] | undefined;
  readonly nativeCapabilities?: readonly string[] | undefined;
}

export interface PluginDependencies {
  readonly required?: Readonly<Record<string, string>> | undefined;
  readonly optional?: Readonly<Record<string, string>> | undefined;
}

export interface PluginPermissions {
  readonly native?: readonly string[] | undefined;
  readonly devices?: readonly string[] | undefined;
  readonly inputSources?: readonly string[] | undefined;
  readonly events?:
    | {
        readonly publishes?: readonly string[] | undefined;
        readonly subscribes?: readonly string[] | undefined;
      }
    | undefined;
  readonly storage?: readonly string[] | undefined;
  readonly windows?: readonly string[] | undefined;
}

export interface PluginContributions {
  readonly services?: readonly ServiceContribution[] | undefined;
  readonly routes?: readonly RouteContribution[] | undefined;
  readonly layouts?: readonly LayoutContribution[] | undefined;
  readonly navigation?: readonly NavigationContribution[] | undefined;
  readonly flows?: readonly FlowContribution[] | undefined;
  readonly flowNodeHandlers?: readonly FlowNodeHandlerContribution[] | undefined;
  readonly flowNodeExecutors?: readonly FlowNodeExecutorContribution[] | undefined;
  readonly effectRunners?: readonly EffectRunnerContribution[] | undefined;
  readonly commands?: readonly CommandContribution[] | undefined;
  readonly commandMiddleware?: readonly CommandMiddlewareContribution[] | undefined;
  readonly conditions?: readonly ConditionContribution[] | undefined;
  readonly validators?: readonly ValidatorContribution[] | undefined;
  readonly devices?: readonly DeviceContribution[] | undefined;
  readonly inputSources?: readonly InputSourceContribution[] | undefined;
  readonly configProviders?: readonly ConfigurationProviderContribution[] | undefined;
  readonly configSchema?: readonly ConfigSchemaContribution[] | undefined;
  readonly migrations?: readonly MigrationContribution[] | undefined;
  readonly repositories?: readonly RepositoryContribution[] | undefined;
  readonly healthChecks?: readonly HealthCheckContribution[] | undefined;
  readonly prompts?: readonly PromptContribution[] | undefined;
  readonly nativeExtensions?: readonly NativeExtensionContribution[] | undefined;
}
