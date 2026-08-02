import {
  FrameworkUiPort,
  LayoutContributionRegistry,
  MenuContributionRegistry,
  RouteContributionRegistry,
  RouteGuardRegistry,
} from "@tripley-kit/web-container-ui-port";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  renderReactNavigation,
  resolveReactNavigation,
  resolveReactRoute,
} from "./contributions";

const CustomerScreen = () => null;
const CustomerLayout = () => null;

describe("React contribution adapters", () => {
  it("resolves a guarded route inside its contributed layout", async () => {
    const routes = new RouteContributionRegistry();
    const layouts = new LayoutContributionRegistry();
    const guards = new RouteGuardRegistry();
    routes.register({
      component: CustomerScreen,
      guards: ["customer.allowed"],
      id: "customer.home",
      layout: "customer.layout",
      path: "/customer/home",
    });
    layouts.register({ component: CustomerLayout, id: "customer.layout" });
    guards.register({ id: "customer.allowed", canActivate: async () => true });

    const result = await resolveReactRoute({
      guards,
      layouts,
      path: "/customer/home",
      routes,
    });

    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.element.type).toBe(CustomerLayout);
    const layoutProps = result.element.props as { readonly children: ReactElement };
    expect(layoutProps.children.type).toBe(CustomerScreen);
  });

  it("returns the guard redirect without rendering the route", async () => {
    const routes = new RouteContributionRegistry();
    const guards = new RouteGuardRegistry();
    routes.register({
      component: CustomerScreen,
      guards: ["session.active"],
      id: "customer.menu",
      path: "/customer/menu",
    });
    guards.register({
      id: "session.active",
      canActivate: async () => ({
        allowed: false,
        reasonCode: "SESSION.MISSING",
        redirectTo: "/customer/idle",
      }),
    });

    await expect(resolveReactRoute({
      guards,
      layouts: new LayoutContributionRegistry(),
      path: "/customer/menu",
      routes,
    })).resolves.toEqual({
      reasonCode: "SESSION.MISSING",
      redirectTo: "/customer/idle",
      status: "blocked",
    });
  });

  it("resolves condition-backed navigation and command activation", async () => {
    const navigation = new MenuContributionRegistry();
    const commands: string[] = [];
    navigation.register({
      commandId: "transaction.withdrawal.start",
      enabledWhen: "transaction.withdrawal.available",
      id: "menu.withdrawal",
      label: "Withdrawal",
      path: "/customer/withdrawal",
      visibleWhen: "features.withdrawal.enabled",
    });
    const entries = await resolveReactNavigation({
      evaluate: async (expression) => expression !== "transaction.withdrawal.available",
      executeCommand: async (commandId) => {
        commands.push(commandId);
      },
      navigation,
      ui: new FrameworkUiPort({ navigate: () => undefined }),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ enabled: false, visible: true });
    const element = renderReactNavigation(entries);
    const { children } = element.props as { readonly children: ReactElement[] };
    const button = children[0] as ReactElement<{ readonly disabled: boolean }>;
    expect(button.props.disabled).toBe(true);
    await entries[0]?.activate();
    expect(commands).toEqual(["transaction.withdrawal.start"]);
  });
});
