import { describe, expect, it } from "vitest";

import {
  FrameworkUiPort,
  ReactRouterNavigationAdapter,
  RouteContributionRegistry,
  ZustandUiStateAdapter,
} from "./index";

describe("UiPort adapters", () => {
  it("stores and patches UI state through a Zustand-compatible adapter", () => {
    const state: Record<string, unknown> = {};
    const adapter = new ZustandUiStateAdapter({
      getState: () => state,
      setState: (partial) => {
        Object.assign(state, typeof partial === "function" ? partial(state) : partial);
      },
    });
    const ui = new FrameworkUiPort({ navigate: () => {} }, adapter);
    const scope = { flowInstanceId: "flow-1", windowKey: "kiosk.customer" };

    ui.setState(scope, "input", { value: "1" });
    ui.patchState<{ value: string; error?: string }>(scope, "input", { error: "tooShort" });

    expect(ui.getState(scope, "input")).toEqual({ error: "tooShort", value: "1" });
  });

  it("keeps React Router behind a callback boundary", async () => {
    const navigations: unknown[] = [];
    const ui = new FrameworkUiPort(
      new ReactRouterNavigationAdapter({
        navigate: (path, options) => navigations.push({ options, path }),
      }),
    );

    await ui.navigate("/customer/home", { replace: true, state: { from: "test" } });

    expect(navigations).toEqual([
      { options: { replace: true, state: { from: "test" } }, path: "/customer/home" },
    ]);
  });

  it("registers route contributions", () => {
    const routes = new RouteContributionRegistry();
    routes.register({ component: {}, id: "customer.home", path: "/customer/home" });

    expect(routes.require("customer.home").path).toBe("/customer/home");
  });

  it("notifies observable consumers after UI state changes", () => {
    const ui = new FrameworkUiPort({ navigate: () => undefined });
    const revisions: number[] = [];
    const unsubscribe = ui.subscribe(() => revisions.push(ui.getRevision()));

    ui.setState({}, "screen", { id: "idle" });
    ui.patchState<{ id: string; message?: string }>(
      {},
      "screen",
      { message: "ready" },
    );
    unsubscribe();
    ui.setState({}, "screen", { id: "menu" });

    expect(revisions).toEqual([1, 2]);
  });
});
