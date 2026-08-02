import { FrameworkError } from "@tripley-kit/web-container-errors";

export const uiPortPackageName = "@tripley-kit/web-container-ui-port";

export interface NavigateOptions {
  readonly replace?: boolean | undefined;
  readonly state?: unknown;
}

export interface UiStateScope {
  readonly windowId?: string | undefined;
  readonly windowKey?: string | undefined;
  readonly pluginId?: string | undefined;
  readonly flowInstanceId?: string | undefined;
}

export interface UiPort {
  navigate(path: string, options?: NavigateOptions): Promise<void>;
  getState<T = unknown>(scope: UiStateScope, key: string): T | undefined;
  setState<T = unknown>(scope: UiStateScope, key: string, value: T): void;
  patchState<T extends object>(scope: UiStateScope, key: string, patch: Partial<T>): void;
}

export interface ObservableUiPort extends UiPort {
  getRevision(): number;
  subscribe(listener: () => void): () => void;
}

export interface UiNavigationAdapter {
  navigate(path: string, options?: NavigateOptions): Promise<void> | void;
}

export interface UiStateAdapter {
  get<T = unknown>(scope: UiStateScope, key: string): T | undefined;
  set<T = unknown>(scope: UiStateScope, key: string, value: T): void;
  patch<T extends object>(scope: UiStateScope, key: string, patch: Partial<T>): void;
}

export class FrameworkUiPort implements ObservableUiPort {
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  public constructor(
    private readonly navigation: UiNavigationAdapter,
    private readonly state: UiStateAdapter = new MemoryUiStateAdapter(),
  ) {}

  public async navigate(path: string, options?: NavigateOptions): Promise<void> {
    await this.navigation.navigate(path, options);
  }

  public getState<T = unknown>(scope: UiStateScope, key: string): T | undefined {
    return this.state.get<T>(scope, key);
  }

  public setState<T = unknown>(scope: UiStateScope, key: string, value: T): void {
    this.state.set(scope, key, value);
    this.notify();
  }

  public patchState<T extends object>(scope: UiStateScope, key: string, patch: Partial<T>): void {
    this.state.patch(scope, key, patch);
    this.notify();
  }

  public getRevision(): number {
    return this.revision;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

export class MemoryUiStateAdapter implements UiStateAdapter {
  private readonly state = new Map<string, unknown>();

  public get<T = unknown>(scope: UiStateScope, key: string): T | undefined {
    return this.state.get(stateKey(scope, key)) as T | undefined;
  }

  public set<T = unknown>(scope: UiStateScope, key: string, value: T): void {
    this.state.set(stateKey(scope, key), value);
  }

  public patch<T extends object>(scope: UiStateScope, key: string, patch: Partial<T>): void {
    const keyWithScope = stateKey(scope, key);
    const existing = this.state.get(keyWithScope);
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      throw new FrameworkError({
        category: "configuration",
        code: "ui.state.patch.notObject",
        message: `Cannot patch non-object UI state: ${key}`,
        metadata: { key },
      });
    }

    this.state.set(keyWithScope, { ...existing, ...patch });
  }
}

export interface ZustandLikeStore<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  getState(): TState;
  setState(
    partial: Partial<TState> | ((state: TState) => Partial<TState>),
    replace?: boolean,
  ): void;
}

export class ZustandUiStateAdapter implements UiStateAdapter {
  public constructor(private readonly store: ZustandLikeStore) {}

  public get<T = unknown>(scope: UiStateScope, key: string): T | undefined {
    return this.store.getState()[stateKey(scope, key)] as T | undefined;
  }

  public set<T = unknown>(scope: UiStateScope, key: string, value: T): void {
    this.store.setState({ [stateKey(scope, key)]: value });
  }

  public patch<T extends object>(scope: UiStateScope, key: string, patch: Partial<T>): void {
    const scopedKey = stateKey(scope, key);
    const existing = this.store.getState()[scopedKey];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      throw new FrameworkError({
        category: "configuration",
        code: "ui.zustand.patch.notObject",
        message: `Cannot patch non-object UI state: ${key}`,
        metadata: { key },
      });
    }

    this.store.setState({ [scopedKey]: { ...existing, ...patch } });
  }
}

export interface ReactRouterBoundary {
  navigate(
    path: string,
    options?: { readonly replace?: boolean | undefined; readonly state?: unknown },
  ): void;
}

export class ReactRouterNavigationAdapter implements UiNavigationAdapter {
  public constructor(private readonly router: ReactRouterBoundary) {}

  public navigate(path: string, options?: NavigateOptions): void {
    this.router.navigate(path, options);
  }
}

export interface RouteContribution {
  readonly id: string;
  readonly path: string;
  readonly component: unknown;
  readonly layout?: string | undefined;
  readonly guards?: readonly string[] | undefined;
  readonly ownerPluginId?: string | undefined;
}

export interface LayoutContribution {
  readonly id: string;
  readonly component: unknown;
  readonly ownerPluginId?: string | undefined;
}

export interface NavigationContribution {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly commandId?: string | undefined;
  readonly area?: "customer" | "admin" | "developer" | (string & {}) | undefined;
  readonly order?: number | undefined;
  readonly visibleWhen?: string | readonly string[] | undefined;
  readonly enabledWhen?: string | readonly string[] | undefined;
  readonly ownerPluginId?: string | undefined;
}

export interface RouteGuardContext {
  readonly path: string;
  readonly routeId?: string | undefined;
  readonly scope?: UiStateScope | undefined;
  readonly [key: string]: unknown;
}

export type RouteGuardResult =
  | boolean
  | {
      readonly allowed: boolean;
      readonly redirectTo?: string | undefined;
      readonly reasonCode?: string | undefined;
    };

export interface RouteGuard {
  readonly id: string;
  canActivate(ctx: RouteGuardContext): Promise<RouteGuardResult>;
}

export class ContributionRegistry<TContribution extends { readonly id: string }> {
  private readonly contributions = new Map<string, TContribution>();

  public constructor(private readonly name: string) {}

  public register(contribution: TContribution): void {
    if (this.contributions.has(contribution.id)) {
      throw new FrameworkError({
        category: "extension",
        code: "ui.contribution.duplicate",
        message: `${this.name} contribution already registered: ${contribution.id}`,
        metadata: { contributionId: contribution.id, registryName: this.name },
      });
    }

    this.contributions.set(contribution.id, contribution);
  }

  public get(id: string): TContribution | undefined {
    return this.contributions.get(id);
  }

  public require(id: string): TContribution {
    const contribution = this.contributions.get(id);
    if (!contribution) {
      throw new FrameworkError({
        category: "extension",
        code: "ui.contribution.missing",
        message: `${this.name} contribution is missing: ${id}`,
        metadata: { contributionId: id, registryName: this.name },
      });
    }

    return contribution;
  }

  public list(): TContribution[] {
    return [...this.contributions.values()];
  }
}

export class RouteContributionRegistry extends ContributionRegistry<RouteContribution> {
  public constructor() {
    super("routes");
  }
}

export class LayoutContributionRegistry extends ContributionRegistry<LayoutContribution> {
  public constructor() {
    super("layouts");
  }
}

export class MenuContributionRegistry extends ContributionRegistry<NavigationContribution> {
  public constructor() {
    super("navigation");
  }

  public override list(): NavigationContribution[] {
    return super.list().sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }
}

export class RouteGuardRegistry extends ContributionRegistry<RouteGuard> {
  public constructor() {
    super("routeGuards");
  }
}

const stateKey = (scope: UiStateScope, key: string): string =>
  JSON.stringify({
    flowInstanceId: scope.flowInstanceId,
    key,
    pluginId: scope.pluginId,
    windowId: scope.windowId,
    windowKey: scope.windowKey,
  });
