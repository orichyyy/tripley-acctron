import { describe, expect, it } from "vitest";

import { createReactWindowRoot } from "./root";

describe("createReactWindowRoot", () => {
  it("renders through the injected root and unmounts once", () => {
    const rendered: unknown[] = [];
    let unmounts = 0;
    const root = createReactWindowRoot({} as Element, {
      factory: () => ({
        render: (node) => rendered.push(node),
        unmount: () => {
          unmounts += 1;
        },
      }),
      windowKey: "kiosk.customer",
    });

    root.render("screen");
    root.dispose();
    root.dispose();

    expect(rendered).toEqual(["screen"]);
    expect(unmounts).toBe(1);
    expect(() => root.render("late")).toThrowError(/already disposed/);
  });
});
