import { describe, expect, it, vi } from "vitest";
import { HttpJsonTransport } from "./index.js";

describe("HttpJsonTransport", () => {
  it("posts and decodes JSON", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ approved: true }), { status: 200 }),
    );
    const transport = new HttpJsonTransport<{ amount: number }, { approved: boolean }>({
      endpoint: "https://host.example/transactions",
      fetch,
    });
    await expect(transport.send({ amount: 100 })).resolves.toEqual({ approved: true });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
