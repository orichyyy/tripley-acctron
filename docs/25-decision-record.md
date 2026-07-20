# 25. Decision Record

This file records confirmed user decisions.

## Architecture

```text
A1=3 multi-host web container.
A2=2 native host windows.
A3=2 monorepo.
A4=1 modern browser/WebView.
A5=4 project template + plugin bundle + runtime preset.
```

## Event Bus

```text
B1=4 unified native/plugin/flow/window/UI bus.
B2=3 async/error isolation/timeout/retry capability; retry ultimately delegated to Flow.
B3=3 core typed, plugin manifest extension.
B4=2 namespace recommended.
B5=2 no permission enforcement.
B6=3 dev trace, prod configurable.
B7=4 cross-window broadcast + request-response.
E1=2 same publisher+topic ordering.
E2=1 request first responder.
E3=3 no event bus auto retry.
E4=1 dead-letter.
E5=1 BroadcastChannel first.
E6=2 memory + optional SQLite trace.
```

## Flow

```text
F1=3 TS DSL primary + JSON import/export.
F2=4 DAG + node state machine.
F3=3 direct ctx + effect-first.
F4=3 optional SQLite persistence.
F5=4 pause/resume + wait event.
F6=3 flow+node timeout.
F7=4 flow+node retry default off.
F8=4 node onError + flow catch/finally.
F9=4 compensation design, not mandatory v1.
F10=1 explicit flowEngine.start only.
F11=4 Flow can navigate and patch UI state.
F12=4 Flow can manage windows and wait window events.
F13=3 trace summary/duration/error/traceId.
F14=3 configurable concurrency.
F15=4 pluggable validators.
F16=4 use flow-engine in docs.
FL1=3 full node type set.
FL2=3 userInput waits for CommandResult; Command routes result to active flow.
FL3=4 standardized transition results + effects.
FL4=4 decision + condition-driven branch.
FL5=4 parallel + race.
FL6=4 timeout policy with handler/next/cancel/retry + project preset default.
FL7=4 interrupt priority + node override + project default.
FL8=2 interrupt executes finally.
FL9=4 flow/node hooks + global middleware.
FL10=4 sync + async subflow.
FL11=3 instance binds version.
FL12=4 recovery policy discard/manual/auto.
FL13=3 ctx.db.transaction helper.
FL14=4 idempotency at command/flow/side-effect.
FL15=3 cancellation source + reasonCode + metadata.
FL16=3 summary default + safeToLog fields.
FL17=4 flow testing DSL + trace snapshot.
FL18=4 command can run simple logic; transaction/device/host uses Flow.
```

## Window/Kiosk

```text
W1=4 native SDK window API required.
W2=2 windowKey + windowId.
W3=1 same key single instance.
W4=1 open existing focuses existing.
W5=3 path + payload + features.
W6=4 strict feature support.
W7=3 rich lifecycle events.
W8=3 broadcast + request-response.
W9=3 named root windows.
W10=4 restore interface reserved.
W11=4 full SDK gap record.
K1=3 single-screen default one window, overlay advanced.
K2=3 multi-screen launch determined by project config.
K3=4 display role mapping from config + admin setup.
K4=3 screen takeover managed by Flow.
K5=4 release action determined by Flow.
K6=2 unsupported features fail fast.
```

## Plugin

```text
P1=4 service/UI/flow/native adapter/project preset etc.
P2=3 static + dynamic, v1 static primary.
P3=4 full manifest, permissions warning.
P4=3 install/register/activate/deactivate/dispose.
P5=4 dependencies + version range.
P6=4 service registry + event request-response.
P7=4 route/component/navigation.
P8=4 flow definition + node handler.
P9=4 project/runtime/device/env config.
P10=4 logic isolation, iframe/worker reserved.
P11=2 permissions warning.
P12=4 plugin error captured; activate failure handled by startup policy.
P13=3 kiosk base preset + plugin bundle + template.
```

## Config and Logging

```text
G1=5 CLI > env > SQLite > JSON > defaults, customizable.
G2=2 admin writes default SQLite.
G3=3 dot and colon path.
G4=3 reload/watch + core.config.changed.
G5=4 Zod/JSON Schema at startup and save.
G6=3 redaction + native secure storage requirement.
G7=3 framework/project/device/plugin/runtime/window/user.

L1=1 JsonFormatter JSON Lines.
L2=2 daily rolling.
L3=3 compression configurable default true.
L4=2 14 files.
L5=3 dev console+file, prod file.
L6=2 console fallback + warning.
L7=2 dev DEBUG, kiosk prod INFO.
L8=3 dev direct, prod queued.
L9=2 flush error, close shutdown.
L10=2 traces in same app log + memory trace.
L11=1 eventId required.
L12=2 redaction default.
L13=2 hashed userId only.
L14=2 viewer guidance only.
```

## Storage/Kiosk Common Modules

```text
S1=2 SQLite required for kiosk base, optional framework.
S2=3 optional Drizzle adapter.
S3=2 standard transaction/message repository.
S4=2 framework CounterService.
S5=3 config KV value_json + value_type + schema_id.
S6=2 Prism-like Command System.
S7=2 async Condition Registry.
S8=3 MenuActionContribution + Command Middleware.
S9=2 Browser speechSynthesis default TTS.
S10=2 flow-level userInput timeout, node override.
S11=2 flow-level interrupt, node override.
S12=2 five-level ScopedStore.
```

## Lifecycle/Tooling

```text
Z1=1 Native SDK connect -> config load -> logger -> event bus -> plugins -> windows -> flows.
Z2=4 missing native capability fail fast.
Z3=1 plugin activate failure fails app startup.
Z4=2 stop flow -> deactivate plugins -> close windows -> logger close -> native dispose.
Z5=3 reconnect policy supported default off.
Z6=2 permission warning/trace.
Z7=2 secrets can be SQLite insecure with explicit mark + secure storage requirement.
Z8=2 Vitest.
Z9=3 full testing harness.
Z10=2 pnpm workspaces.
Z11=2 tsup packages + Vite apps.
Z12=3 Biome.
Z13=2 @tripley-kit/web-container-*.
Z14=1 Markdown folder + zip.
```

## Additional modules accepted

```text
M1 Device Abstraction Layer = core-kiosk.
M2 Audit Journal / EJ = core-kiosk.
M3 Resilience Policy = optional, kiosk default enabled.
M4 Idempotency / Operation Ledger = core-storage.
M5 Business Calendar / Clock = core.
M6 Feature Flag / Capability Policy = core.
M7 Localization / Prompt Catalog = kiosk.
M8 Accessibility Service = kiosk.
M9 Diagnostics / Health Check Center = core.
M10 Error Catalog / Result Code System = core.
M11 Outbox / Reliable Message = optional, recommended for banking.
M12 Project Preset / Blueprint = core.
```
