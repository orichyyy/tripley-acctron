# 18. Condition and Policy Engine

## Purpose

Centralize visibility, enabled state, route guards, command canExecute, flow branch, and business policy checks.

## Condition contract

```ts
export interface Condition<TInput = unknown> {
  id: string;
  evaluate(ctx: ConditionContext, input?: TInput): boolean | Promise<boolean | ConditionResult>;
}

export interface ConditionResult {
  allowed: boolean;
  reasonCode?: string;
  message?: string;
  messageKey?: string;
  data?: Record<string, unknown>;
}
```

## UI usage

```ts
{
  id: 'menu.withdrawal',
  label: '取款',
  commandId: 'kiosk.withdrawal.start',
  visibleWhen: 'cash.available',
  enabledWhen: ['session.customerAuthenticated', 'device.cashUnit.ready']
}
```

## Examples

Cash available:

```ts
conditionRegistry.register({
  id: 'cash.available',
  evaluate: async ctx => {
    const status = await ctx.devices.get<CashUnitPort>('cashUnit').getStatus();
    return { allowed: status.totalCashCount > 0, reasonCode: status.totalCashCount > 0 ? undefined : 'cash.empty' };
  }
});
```

Business hours:

```ts
conditionRegistry.register({
  id: 'businessHours.cardApplication',
  evaluate: async ctx => {
    const now = ctx.clock.now();
    return { allowed: ctx.calendar.isBusinessDay(now) && ctx.calendar.isWithinWindow(now, 'cardApplication') };
  }
});
```

## Best practices

- `visibleWhen` controls rendering only.
- `enabledWhen` controls button interactivity.
- `command.canExecute` is the final UI-action guard.
- High-risk business operations must validate again in Command/Flow/service layer.
- All denied results should carry `reasonCode`.

## Feature flag integration

Feature flags are conditions:

```text
features.withdrawal.enabled
features.cardApplication.enabled
```

Admin may modify feature flags through Configuration and persist to SQLite.
