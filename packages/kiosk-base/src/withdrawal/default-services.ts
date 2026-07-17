import {
  AccessibilityService,
  DefaultBusinessCalendar,
  FeatureFlagService,
  HealthCheckCenter,
  InMemoryOperationLedger,
  PromptCatalog,
} from "../services";

export const createDefaultKioskServices = () => ({
  accessibility: new AccessibilityService(),
  businessCalendar: new DefaultBusinessCalendar(),
  featureFlags: new FeatureFlagService([
    { enabled: true, id: "features.withdrawal.enabled" },
    { enabled: true, id: "features.withdrawal.qrInput.enabled" },
  ]),
  health: new HealthCheckCenter(),
  operationLedger: new InMemoryOperationLedger(),
  promptCatalog: new PromptCatalog([
    { key: "withdrawal.amount.prompt", locale: "en", text: "Enter withdrawal amount" },
    { key: "withdrawal.pin.prompt", locale: "en", text: "Enter your PIN" },
    {
      key: "withdrawal.amount.invalid",
      locale: "en",
      text: "Enter an amount greater than zero",
    },
  ]),
});
