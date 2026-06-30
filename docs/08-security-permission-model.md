# 08. Security and Permission Model

## Purpose

Provide capability declaration, data classification, secret redaction, and future enforcement hooks without blocking v1 development.

## v1 permission decision

Plugin manifest declares permissions. Runtime behavior:

```text
dev: warning on undeclared use
prod: trace record on undeclared use
no hard enforcement in v1
```

Native required capability failures still fail fast.

## Data classification

```ts
export type DataClassification =
  | 'public'
  | 'internal'
  | 'sensitive'
  | 'secret'
  | 'regulated';
```

Rules:

| Classification | Log | UI state | ScopedStore | SQLite | Notes |
| --- | --- | --- | --- | --- | --- |
| public | allowed | allowed | allowed | allowed | basic metadata |
| internal | summary preferred | allowed | allowed | allowed | no external leak |
| sensitive | safeSummary only | limited | limited | explicit schema | PII-like data |
| secret | no value, redacted | no | no plain | insecure unless secure storage | token/password/PIN |
| regulated | safeSummary only | no raw | no raw | project policy | PIN blocks/biometric |

## Secure input rules

For `security: 'secure'` user input:

- Only secure input source kinds are allowed, such as `pinpad.pin`.
- Plain fallbacks such as barcode/regular UI are forbidden.
- No raw value in UI state, ScopedStore, log, trace, or audit.
- Result must provide encrypted/tokenized payload and safeSummary.

## Secret storage

v1 supports redaction. Secrets may be temporarily saved in SQLite only when explicitly marked insecure. Native Secure Storage is tracked as `NATIVE-API-012`.

## Capability checks

Capability checks occur during:

- Native connect.
- Project preset validation.
- Plugin registration.
- Flow registration.
- Window layout initialization.
- Device adapter registration.

All required capability failures fail fast.

## Future enforcement

The permission model can later become an interceptor layer around ports/registries. Do not design business code to bypass ports.
