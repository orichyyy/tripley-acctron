import { createHostMessageService } from "@tripley-kit/web-container-host-message";
import { describe, expect, it } from "vitest";

import { decodeBspV243OexResponse, packBspV243OexRequest } from "./oex";
import {
  BSP_V243_ATM_MESSAGE_BYTES,
  BSP_V243_HOST_MESSAGE_BYTES,
  bspV243OexRequestReference,
  bspV243Profile,
} from "./profile";
import { packOexResponse, terminalSnapshot } from "./test-fixture";

describe("Taiwan BSP v2.43 OEX profile", () => {
  it("packs the independent 720-byte OEX B001 golden layout", () => {
    const { service } = createHostMessageService({ profiles: [bspV243Profile] });
    const packed = packBspV243OexRequest(service, terminalSnapshot);
    expect(packed.status).toBe("packed");
    if (packed.status !== "packed") return;

    expect(packed.message.bytes).toHaveLength(BSP_V243_ATM_MESSAGE_BYTES);
    const text = new TextDecoder().decode(packed.message.bytes);
    expect(text.slice(2, 5)).toBe("OEX");
    expect(text.slice(14, 19)).toBe(terminalSnapshot.atmId);
    expect(text.slice(81, 85)).toBe("B001");
    expect(text.slice(126, 129)).toBe("TWN");

    const decoded = service.unpack({
      bytes: packed.message.bytes,
      reference: bspV243OexRequestReference,
    });
    expect(decoded.status).toBe("complete");
    if (decoded.status !== "complete") return;
    expect(service.safeSummary(decoded.message).fields).toEqual({
      oexCountry: "TWN",
      oexStatusReason: "B001",
      requestAtmId: "12345",
      requestMode: "1",
      requestServiceStatus: "0",
      requestTransactionCode: "OEX",
    });
  });

  it("strictly validates the 748-byte OEX response and safe reject code", () => {
    const { service } = createHostMessageService({ profiles: [bspV243Profile] });
    const response = packOexResponse(service);

    expect(response).toHaveLength(BSP_V243_HOST_MESSAGE_BYTES);
    expect(decodeBspV243OexResponse(service, response, terminalSnapshot.atmId).status).toBe(
      "accepted",
    );
    expect(
      decodeBspV243OexResponse(
        service,
        packOexResponse(service, { oexRejectCode: "E001" }),
        terminalSnapshot.atmId,
      ),
    ).toEqual({ status: "rejected", errorCode: "bsp.v243.oex.rejected" });
    expect(
      decodeBspV243OexResponse(service, response.slice(0, 100), terminalSnapshot.atmId),
    ).toEqual({
      status: "rejected",
      errorCode: "bsp.v243.oex.response-invalid",
    });
  });
});
