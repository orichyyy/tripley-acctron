# 27. Clock, Business Calendar, Feature Flags, Prompt Catalog, and Accessibility

## Purpose

Provide reusable services for business-hour conditions, feature enablement, localized UI/TTS/EJ prompts, and accessibility modes such as blind mode.

## Clock

Core provides a `Clock` so Flow/Condition tests can mock time.

```ts
export interface Clock {
  now(): Date;
  nowEpochMs(): number;
}
```

Production uses system time. Tests use fake clock.

## Business Calendar

```ts
export interface BusinessCalendar {
  isBusinessDay(date: Date, calendarId?: string): boolean;
  isWithinWindow(date: Date, windowId: string): boolean;
  getNextOpenTime(windowId: string, from?: Date): Date | null;
}
```

Use cases:

- Card application visible only on business days 09:00-17:00.
- Host maintenance windows.
- Branch holidays.
- Special event days.

Configuration example:

```json
{
  "businessCalendar": {
    "windows": {
      "cardApplication": { "days": ["Mon", "Tue", "Wed", "Thu", "Fri"], "start": "09:00", "end": "17:00" }
    },
    "holidays": ["2026-01-01"]
  }
}
```

Condition example:

```ts
conditionRegistry.register({
  id: 'businessHours.cardApplication',
  evaluate: ctx => ({ allowed: ctx.calendar.isBusinessDay(ctx.clock.now()) && ctx.calendar.isWithinWindow(ctx.clock.now(), 'cardApplication') })
});
```

## Feature Flags

Feature flags are configuration-backed conditions.

```ts
export interface FeatureFlagService {
  isEnabled(flagId: string, ctx?: FeatureFlagContext): Promise<boolean>;
  setEnabled(flagId: string, enabled: boolean, options?: FeatureFlagWriteOptions): Promise<void>;
}
```

Examples:

```text
features.withdrawal.enabled
features.cardApplication.enabled
features.adminMaintenance.enabled
features.mobileQrInput.enabled
```

Admin changes persist to SQLite configuration provider.

## Prompt Catalog

Prompt catalog centralizes UI text, TTS text, and EJ/audit messages.

```ts
export interface PromptCatalog {
  get(key: string, params?: Record<string, unknown>, options?: PromptOptions): string;
  has(key: string, options?: PromptOptions): boolean;
  registerPack(pack: PromptPack): void;
}

export interface PromptPack {
  id: string;
  locale: string;
  messages: Record<string, string>;
}
```

Example:

```ts
const text = promptCatalog.get('withdrawal.selected', { amount }, { locale: 'zh-TW' });
await ctx.tts.speak(text);
await ctx.audit.recordCustomerSelection(text);
```

Best practices:

- Do not hardcode customer-visible prompts in Flow nodes.
- Use prompt keys in flow/userInput/command definitions.
- Allow bank project overrides.
- Accessibility mode can use alternate prompt pack.

## Accessibility Service

```ts
export interface AccessibilityService {
  getMode(): AccessibilityMode;
  setMode(mode: AccessibilityMode): void;
  isBlindMode(): boolean;
  onModeChanged(handler: (mode: AccessibilityMode) => void): Subscription;
}

export interface AccessibilityMode {
  blindMode?: boolean;
  highContrast?: boolean;
  largeText?: boolean;
  ttsEnabled?: boolean;
  locale?: string;
}
```

Use cases:

- Blind mode enables TTS and verbose prompts.
- SIU headphone removed event interrupts active transaction.
- High-contrast and large-text alter UI layout/theme.
- Accessibility mode is stored in session scope and cleared at session end.

## Integration points

- Condition engine reads feature flags and business calendar.
- Command middleware reads prompt catalog for audit/TTS.
- UserInputNode uses prompt keys from resolved input profile.
- Flow interrupt policy checks AccessibilityService.
- UI adapter reads accessibility mode for theme/font changes.
