import { describe, expect, test } from "vitest";
import { FakeHostGateway } from "./fake-host";

describe("fake host gateway", () => {
  test("records requests and returns queued response", async () => {
    const host = new FakeHostGateway();
    host.enqueueResponse({ approved: true });

    await expect(host.send("accountInquiry", { account: "123" })).resolves.toEqual({
      requestId: "fake-host-1",
      status: "approved",
      body: { approved: true },
    });
    expect(host.sent).toEqual([
      {
        messageType: "accountInquiry",
        body: { account: "123" },
      },
    ]);
  });

  test("returns queued failure", async () => {
    const host = new FakeHostGateway();
    host.enqueueFailure(new Error("host down"));

    await expect(host.request({ messageType: "accountInquiry", body: {} })).rejects.toThrow(
      "host down",
    );
  });
});
