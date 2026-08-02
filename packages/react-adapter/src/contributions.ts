import { FrameworkError } from "@tripley-kit/web-container-errors";
import type {
  LayoutContributionRegistry,
  MenuContributionRegistry,
  NavigationContribution,
  RouteContribution,
  RouteContributionRegistry,
  RouteGuardContext,
  RouteGuardRegistry,
  UiPort,
} from "@tripley-kit/web-container-ui-port";
import {
  createElement,
  isValidElement,
  type ComponentType,
  type ReactElement,
} from "react";

export interface ResolveReactRouteOptions {
  readonly path: string;
  readonly routes: RouteContributionRegistry;
  readonly layouts: LayoutContributionRegistry;
  readonly guards: RouteGuardRegistry;
  readonly guardContext?: Omit<RouteGuardContext, "path" | "routeId"> | undefined;
}

export type ReactRouteResolution =
  | { readonly status: "notFound" }
  | {
      readonly status: "blocked";
      readonly reasonCode?: string | undefined;
      readonly redirectTo?: string | undefined;
    }
  | {
      readonly status: "matched";
      readonly route: RouteContribution;
      readonly element: ReactElement;
    };

export const resolveReactRoute = async (
  options: ResolveReactRouteOptions,
): Promise<ReactRouteResolution> => {
  const route = options.routes.list().find(({ path }) => path === options.path);
  if (!route) return { status: "notFound" };
  for (const guardId of route.guards ?? []) {
    const result = await options.guards.require(guardId).canActivate({
      ...options.guardContext,
      path: route.path,
      routeId: route.id,
    });
    const normalized = typeof result === "boolean" ? { allowed: result } : result;
    if (!normalized.allowed) {
      return {
        status: "blocked",
        reasonCode: normalized.reasonCode,
        redirectTo: normalized.redirectTo,
      };
    }
  }
  const routeElement = contributionElement(route.component, { route });
  if (!route.layout) {
    return { element: routeElement, route, status: "matched" };
  }
  const layout = options.layouts.require(route.layout);
  return {
    element: contributionElement(layout.component, { children: routeElement, route }),
    route,
    status: "matched",
  };
};

export interface ReactNavigationEntry {
  readonly contribution: NavigationContribution;
  readonly enabled: boolean;
  readonly visible: boolean;
  activate(): Promise<void>;
}

export interface ResolveReactNavigationOptions {
  readonly navigation: MenuContributionRegistry;
  readonly ui: UiPort;
  readonly evaluate?: (
    expression: string | readonly string[] | undefined,
    contribution: NavigationContribution,
  ) => boolean | Promise<boolean>;
  readonly executeCommand?: (commandId: string) => void | Promise<void>;
}

export const resolveReactNavigation = async (
  options: ResolveReactNavigationOptions,
): Promise<readonly ReactNavigationEntry[]> =>
  Promise.all(
    options.navigation.list().map(async (contribution) => ({
      contribution,
      enabled: await evaluateNavigation(
        options.evaluate,
        contribution.enabledWhen,
        contribution,
      ),
      visible: await evaluateNavigation(
        options.evaluate,
        contribution.visibleWhen,
        contribution,
      ),
      activate: async () => {
        if (contribution.commandId) {
          if (!options.executeCommand) {
            throw new FrameworkError({
              category: "configuration",
              code: "react.navigation.commandExecutor.missing",
              message: `Navigation command executor is missing: ${contribution.commandId}`,
            });
          }
          await options.executeCommand(contribution.commandId);
          return;
        }
        await options.ui.navigate(contribution.path);
      },
    })),
  );

export const renderReactNavigation = (
  entries: readonly ReactNavigationEntry[],
  className?: string,
): ReactElement =>
  createElement(
    "nav",
    { className },
    entries
      .filter(({ visible }) => visible)
      .map((entry) =>
        createElement(
          "button",
          {
            disabled: !entry.enabled,
            key: entry.contribution.id,
            onClick: () => void entry.activate(),
            type: "button",
          },
          entry.contribution.label,
        ),
      ),
  );

const contributionElement = (
  component: unknown,
  props: Readonly<Record<string, unknown>>,
): ReactElement => {
  if (isValidElement(component)) return component;
  if (typeof component !== "function" && typeof component !== "string") {
    throw new FrameworkError({
      category: "configuration",
      code: "react.contribution.component.invalid",
      message: "React contribution component must be an element or component type.",
    });
  }
  return createElement(component as ComponentType<Record<string, unknown>>, props);
};

const evaluateNavigation = async (
  evaluate: ResolveReactNavigationOptions["evaluate"],
  expression: string | readonly string[] | undefined,
  contribution: NavigationContribution,
): Promise<boolean> => expression === undefined || !evaluate
  ? true
  : evaluate(expression, contribution);
