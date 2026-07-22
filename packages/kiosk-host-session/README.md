# @tripley-kit/web-container-kiosk-host-session

Transport-neutral supervision for long-lived kiosk host sessions.

The supervisor owns readiness, protocol establishment, heartbeat scheduling, retry, generation
fencing, and safe lifecycle events. Project code owns all bank-specific message construction and
response interpretation.

```ts
const supervisor = new HostSessionSupervisor({
  id: "bsp.primary",
  transport: persistentNativeSession,
  protocol: {
    async establish(context) {
      const result = await context.exchange(buildProjectSignOn(context.generation));
      return interpretProjectSignOn(result);
    },
    async heartbeat(context) {
      const result = await context.exchange(buildProjectEcho(context.generation));
      return interpretProjectEcho(result);
    },
  },
  policy: {
    establishTimeoutMs: 15_000,
    establishRetry: { initialDelayMs: 1_000, maxDelayMs: 30_000, multiplier: 2 },
    heartbeat: { intervalMs: 30_000, timeoutMs: 10_000, failureThreshold: 2 },
  },
});

await supervisor.start();
```

Control hooks may use fixed-field, ISO8583, or future HTTP-backed message services. The supervisor
does not inspect payloads and its lifecycle events contain no request, response, or exception text.
