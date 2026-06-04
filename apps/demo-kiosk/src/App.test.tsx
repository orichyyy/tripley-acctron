import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "./App";

describe("App", () => {
  test("server-renders the ATM demo shell", () => {
    const html = renderToString(<App />);

    expect(html).toContain("ATM Basic");
    expect(html).toContain("Tripley Acctron");
  });
});
