# Target 50: Outbox host delivery and reconciliation

## Objective

Provide a durable, certainty-aware host delivery boundary for financial kiosk messages. A transport
disconnect must never be treated as proof that a request was not received by the host.

## Boundaries

- The generic kiosk outbox remains a lightweight application event outbox.
- `kiosk-host-delivery` owns financial message leasing, retry classification, encrypted payload
  references, response deduplication, inquiry reconciliation, and manual resolution evidence.
- Host message codecs continue to own pack, unpack, validation, and safe summaries.
- Projects own transport adapters, payload encryption, host inquiry protocols, retry policy, and
  operator authorization.
- Raw request and response payloads never enter transaction-message, audit/EJ, logs, or outbox rows.

## Delivery states

- `pending`: eligible for first delivery.
- `leased`: exclusively owned by one worker for a bounded interval.
- `retryScheduled`: the transport proved the request was not sent.
- `uncertain`: the request may have reached the host; blind retry is prohibited.
- `reconciled`: a host response, inquiry result, or authorized manual decision established outcome.
- `failed`: retry policy was exhausted or encrypted payload was unavailable.
- `cancelled`: an authorized operator cancelled delivery before an established host outcome.

An expired `leased` record becomes `uncertain`, not `retryScheduled`, because a process may have
stopped after sending and before recording the response.

## Security

- The outbox stores only `payloadRef` and safe summary metadata.
- A `HostPayloadCipherPort` encrypts payloads before SQLite persistence.
- Ciphertext is associated with the payload reference as authenticated context.
- Response projection stores only safe summaries; raw responses remain in the encrypted vault.

## Reconciliation

- `responseId` is globally unique and response projection is idempotent.
- A duplicate response for the same outbox record returns `duplicate` without adding another
  transaction message or EJ record.
- A reused response ID targeting another outbox record is a conflict requiring intervention.
- Unknown delivery uses project-owned host inquiry when policy permits.
- Inquiry `notFound` allows retry only when the frozen policy explicitly says so.
- Manual decisions require operator ID and reason code and always append immutable audit evidence.

## Acceptance

- Proven-not-sent failures retry with deterministic policy backoff.
- Unknown transport outcomes and expired worker leases never retry automatically.
- Inquiry can reconcile an uncertain request or explicitly return it to the retry queue.
- Duplicate responses create one inbound transaction message and one reconciliation audit record.
- Encrypted request payload and delivery state survive closing and reopening a real SQLite file.
- Manual resolution records operator-safe evidence.
- Project policies can differ between authorization and optional Host Financial Completion.
- Full typecheck, build, and test suites pass.
