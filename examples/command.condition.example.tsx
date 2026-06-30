commandRegistry.register({
  id: "kiosk.withdrawal.start",
  canExecute: async (ctx) => ctx.conditions.evaluateBoolean("cash.available"),
  execute: async (ctx, input) => ctx.flowEngine.start("kiosk.withdrawal", input),
  options: {
    disableWhileRunning: true,
    showLoadingWhileRunning: true,
    audit: { eventId: "customer.selected.withdrawal", text: "客户选择: 取款" },
    tts: { text: "您选择了取款", mode: "interrupt" },
  },
});

conditionRegistry.register({
  id: "cash.available",
  evaluate: async (ctx) => {
    const cashUnit = ctx.devices.get("cashUnit");
    const status = await cashUnit.getStatus();
    return {
      allowed: status.totalCashCount > 0,
      reasonCode: status.totalCashCount > 0 ? undefined : "cash.empty",
    };
  },
});

export function WithdrawalButton() {
  return <CommandButton commandId="kiosk.withdrawal.start">取款</CommandButton>;
}
