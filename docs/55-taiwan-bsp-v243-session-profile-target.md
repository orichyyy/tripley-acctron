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
- The shared transport header follows the RHProxy `MessageFiles/RequestHeader.xml` layout:

| Field | Bytes | Encoding and value |
| --- | ---: | --- |
| `HEADER_1` | 3 | Fixed binary `0F 0F 0F` |
| `HEADER_2` | 3 | BCD total buffer length, including all six Header fields |
| `HEADER_3` | 1 | Fixed binary `01` |
| `HEADER_4` | 3 | ASCII decimal send counter `000` through `999` |
| `HEADER_5` | 1 | Fixed binary `0F` |
| `HEADER_6` | 1 | Fixed binary `0F` |

- The send counter starts at `000`, increments once per successfully framed outbound message, and
  wraps from `999` to `000`. The total buffer length includes all 12 shared header bytes.
- Every BSP request uses the shared frame codec; individual request profiles contain only their
  720-byte message body and cannot redefine the common header.

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
- A framed 720-byte request is 732 bytes and begins
  `0F 0F 0F 00 07 32 01 30 30 30 0F 0F`.
- OEX response strictly decodes 748 bytes and gates readiness.
- Malformed, mismatched, rejected, not-sent, and uncertain outcomes remain distinguishable by safe
  reason codes.
- SNS and other built-in host controls route as inbound messages.
- RBT remains unhandled without explicit project policy.
- A custom host-control plugin works without modifying framework core.
- Full typecheck, tests, and builds pass.
