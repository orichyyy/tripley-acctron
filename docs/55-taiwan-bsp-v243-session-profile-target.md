# Target 55: Taiwan BSP ATM v2.43 Session Profile

## Objective

Implement the first bank-project host profile as application-owned TypeScript scripts. Bind the
Taiwan BSP ATM v2.43 fixed-field protocol to Target 53 persistent sessions and Target 54 session
supervision without adding bank fields to framework core.

## Source binding

- ATM-to-host source: `BSP_FEP_RCV_ATM_20260317V2.43.docx`.
- Host-to-ATM source: `BSP_FEP_TO_ATM_20260317V2.43.docx`.
- Profile version: `2.43-20260317`.
- ATM messages are 720 bytes. Host messages are 748 bytes.
- Transport framing remains three-byte `0F 0F 0F`, three-byte BCD length, and length includes both
  fixed header and length bytes.

## Protocol decisions

- `AEX` is Account anomaly reporting and is not session heartbeat.
- Session establishment sends `OEX` with reason `B001`, which the specification defines as ATM
  service start, then requires an accepted `OEX` response.
- `SNS` is host-initiated line testing. The specification does not define an ATM-to-host `SNS`
  response, so the framework does not invent one.
- `CLS`, `OPN`, `RBT`, `PMD`, and `SNS` are classified as inbound host controls.
- High-risk controls have no default handler. A bank project must explicitly register policy.
- Target 54 client heartbeat remains unset for this profile.

## Extension boundary

- Host-control contributions are open and application-owned.
- Financial response correlation can be extended by project callback.
- Profiles are compiled TypeScript in the application repository and are never loaded from disk at
  runtime.
- Raw payloads and exception details are excluded from lifecycle metadata.

## Acceptance

- OEX request packs to an independently asserted 720-byte layout.
- OEX response strictly decodes 748 bytes and gates readiness.
- Malformed, mismatched, rejected, not-sent, and uncertain outcomes remain distinguishable by safe
  reason codes.
- SNS and other built-in host controls route as inbound messages.
- RBT remains unhandled without explicit project policy.
- A custom host-control plugin works without modifying framework core.
- Full typecheck, tests, and builds pass.
