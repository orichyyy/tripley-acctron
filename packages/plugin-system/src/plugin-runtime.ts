import { KioskError, type KioskPlugin, type PluginContext } from "@tripley-acctron/contracts";

export class PluginRuntime {
  public constructor(private readonly plugins: KioskPlugin[]) {}

  public async setup(ctx: PluginContext): Promise<void> {
    this.validate();
    for (const plugin of this.plugins) {
      ctx.logger.debug("Setting up plugin.", { pluginId: plugin.id, version: plugin.version });
      await plugin.setup(ctx);
    }
  }

  private validate(): void {
    const ids = new Set<string>();
    for (const plugin of this.plugins) {
      if (ids.has(plugin.id)) {
        throw new KioskError("plugin.duplicate", `Duplicate plugin id ${plugin.id}.`);
      }
      ids.add(plugin.id);
    }

    for (const plugin of this.plugins) {
      for (const dependency of plugin.dependsOn ?? []) {
        if (!ids.has(dependency)) {
          throw new KioskError(
            "plugin.dependencyMissing",
            `Plugin ${plugin.id} depends on missing plugin ${dependency}.`,
          );
        }
      }
    }
  }
}
