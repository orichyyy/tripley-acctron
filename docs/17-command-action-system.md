# 17. Command and Action System

## Purpose

Reduce repetitive UI button code: click handlers, loading, disable while running, duplicate click prevention, canExecute checks, flow dispatch, audit/EJ, TTS, logging, and error handling.

The model is inspired by WPF/Prism Command but adapted for Web + Flow + Plugin.

## Command contract

```ts
export interface Command<TInput = unknown, TResult = unknown> {
  id: string;
  title?: string;
  canExecute?(ctx: CommandContext, input: TInput): boolean | Promise<boolean | CommandBlockedReason>;
  execute(ctx: CommandContext, input: TInput): Promise<TResult>;
  options?: CommandOptions;
}
```

## Options

```ts
export interface CommandOptions {
  disableWhileRunning?: boolean;
  showLoadingWhileRunning?: boolean;
  debounceMs?: number;
  throttleMs?: number;
  idempotencyKey?: string | ((input: unknown) => string);
  confirm?: CommandConfirmOptions;
  audit?: CommandAuditOptions;
  tts?: CommandTtsOptions;
}
```

## React usage

```tsx
<CommandButton commandId="kiosk.withdrawal.start" input={{ amount: 1000 }}>
  取款
</CommandButton>
```

`CommandButton` automatically handles loading, disabled state, duplicate click protection, `canExecute`, error feedback, audit, TTS, and command trace.

## Command middleware

```ts
export interface CommandMiddleware {
  id: string;
  beforeExecute?(ctx: CommandContext, command: Command, input: unknown): Promise<void>;
  afterExecute?(ctx: CommandContext, command: Command, result: unknown): Promise<void>;
  onError?(ctx: CommandContext, command: Command, error: unknown): Promise<void>;
}
```

Built-ins:

```text
PolicyCheckCommandMiddleware
LoadingStateCommandMiddleware
IdempotencyCommandMiddleware
AuditJournalCommandMiddleware
TtsCommandMiddleware
LoggerCommandMiddleware
```

## Flow boundary

Simple UI commands may execute directly. Transaction/device/host/audited business must start or resume a Flow.

```ts
commandRegistry.register({
  id: 'kiosk.withdrawal.start',
  canExecute: async ctx => ctx.conditions.evaluateBoolean('cash.available'),
  execute: async (ctx, input) => ctx.flowEngine.start('kiosk.withdrawal', input),
  options: {
    disableWhileRunning: true,
    showLoadingWhileRunning: true,
    audit: { eventId: 'customer.selected.withdrawal', text: '客户选择: 取款' },
    tts: { text: '您选择了取款' }
  }
});
```

## MenuAction contribution

```ts
export interface MenuActionContribution {
  id: string;
  label: string;
  commandId: string;
  visibleWhen?: string | string[];
  enabledWhen?: string | string[];
  audit?: CommandAuditOptions;
  tts?: CommandTtsOptions;
}
```
