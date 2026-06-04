import type { FlowDefinition, HostResponse, StepContext } from "@tripley-acctron/contracts";
import { defineHostRequestStep } from "@tripley-acctron/flow-engine";
import { Recipes } from "@tripley-acctron/recipes";

export const atmBasicSteps = {
  inputAccount: Recipes.inputAccount({
    id: "inputAccount",
    screen: "account.input",
    saveAs: "accountNo",
    constraints: { minLength: 6, maxLength: 18 },
    timeout: { key: "accountInput", durationMs: 90_000 },
    sources: { pinpad: true, barcodeQr: true, uiActions: true },
    routes: {
      valid: "AccountInquiry",
      cancel: "Cancelled",
      timeout: "Timeout",
      failed: "Failed",
    },
  }),
  accountInquiry: defineHostRequestStep({
    id: "accountInquiry",
    messageType: "account.inquiry",
    body: (ctx: StepContext) => ({ accountNo: ctx.transaction?.get("accountNo") }),
    route: (response: HostResponse<{ approved: boolean }>) =>
      response.body?.approved ? "Approved" : "Declined",
    routes: { failed: "Failed" },
  }),
};

export const atmBasicFlow: FlowDefinition = {
  id: "atm-basic",
  version: "1",
  nodes: [
    { id: "start", type: "start" },
    { id: "inputAccount", type: "action", action: "inputAccount" },
    { id: "accountInquiry", type: "action", action: "accountInquiry" },
    { id: "success", type: "end", name: "Success" },
    { id: "declined", type: "end", name: "Declined" },
    { id: "cancelled", type: "end", name: "Cancelled" },
    { id: "timeout", type: "end", name: "Timeout" },
    { id: "failed", type: "end", name: "Failed" },
  ],
  edges: [
    { id: "e0", from: "start", to: "inputAccount" },
    { id: "e1", from: "inputAccount", to: "accountInquiry", route: "AccountInquiry" },
    { id: "e2", from: "inputAccount", to: "cancelled", route: "Cancelled" },
    { id: "e3", from: "inputAccount", to: "timeout", route: "Timeout" },
    { id: "e4", from: "inputAccount", to: "failed", route: "Failed" },
    { id: "e5", from: "accountInquiry", to: "success", route: "Approved" },
    { id: "e6", from: "accountInquiry", to: "declined", route: "Declined" },
    { id: "e7", from: "accountInquiry", to: "failed", route: "Failed" },
  ],
};
