# Host Message Service Foundation Target

## Objective

Add a pure, extensible host-message packing and unpacking service. It must support the application's fixed-field host protocol without a bitmap, a profile-driven ISO 8583 bitmap engine, statically registered project profiles, custom field codec contributions, strict validation, and safe summaries.

The foundation must remain independent of transport, stream framing, transaction persistence, Flow, React, Tripley Native, and bank-specific host operations.

## Domain Boundary

The Host Message Service resolves a versioned profile and codec, translates structured fields to or from bytes, validates the complete wire body, and creates a policy-safe summary.

Message framing locates complete bodies in a stream. Host transports exchange framed bytes. Host API adapters map business operations to HTTP interactions. These are separate later targets.

## Profile Ownership

- Profiles live in the kiosk application repository under its `script` source tree.
- The application composition root statically imports and registers profiles.
- Profiles are bundled with the application and never scanned or loaded from deployment storage.
- Profiles are identified by stable `profileId` and `version` values.
- A runtime freezes its profile and codec registries after composition.
- Changing a profile requires a new application build and runtime.
- Profiles are declarative and contain no evaluated strings or anonymous executable functions.
- Custom algorithms are trusted source modules registered by stable field codec ID.
- A profile represents one versioned host protocol family and contains shared field definitions plus explicit message definitions.
- A message definition represents one request, response, or advice wire schema.
- Every runtime operation selects an exact `profileId`, `profileVersion`, and `messageId` reference.
- Fixed-field message definitions declare exact field order.
- ISO 8583 message definitions declare MTI and required, optional, and forbidden data elements.
- Registration resolves permitted shared definitions and overrides into complete immutable message definitions; runtime decoding performs no inheritance.

## Package Shape

Implement `packages/host-message` as a deep module with focused internal files for contracts, profiles, registries, service orchestration, safety, errors, field codecs, fixed-field encoding, and ISO 8583 encoding.

The public facade exposes the minimum contracts needed to define profiles, register codecs, pack, unpack, and produce safe summaries. Internal cursor, bitmap, padding, and byte-manipulation helpers remain private.

## Required Registries

### HostMessageProfileRegistry

- Registers immutable profiles by ID and version.
- Rejects duplicate ID/version registrations.
- Resolves an exact version with no implicit latest-version fallback during an operation.
- Resolves an exact message definition within that version with no MTI, payload-content, or latest-version guessing.
- Validates profiles before registration.
- Rejects registration after freeze.

### HostMessageCodecRegistry

- Registers codecs by stable codec kind.
- Includes built-in fixed-field and ISO 8583 codecs through ordinary registration.
- Allows a project plugin to contribute a future message codec without modifying service orchestration.
- Rejects duplicates and registration after freeze.

### FieldCodecRegistry

- Registers pure trusted field transformations by stable ID.
- Profiles refer to codec IDs rather than inline functions.
- Rejects unknown codecs during profile validation.
- Rejects duplicates and registration after freeze.

## Encoding Policy

- Core built-ins are ASCII, UTF-8, packed BCD, raw binary, and ASCII hex.
- BCD declarations specify digit count, odd-digit pad nibble, and pad direction explicitly.
- BIG5, BIG5 EUDC, GB2312/GBK, IBM037, IBM937, EBCDIC hex, hex-30-offset, and private character maps are static field codec contributions rather than assumed platform encodings.
- Legacy codecs carry stable IDs and versions and require golden byte-vector tests.
- BIG5 EUDC and private code pages require an application-owned mapping version.
- Profile registration fails when a referenced legacy codec is unavailable.
- The service never guesses a legacy codec from runtime defaults or `TextDecoder` behavior.

## Resource Limits

- The default service message ceiling is 64 KiB.
- Application composition may explicitly raise or lower that ceiling, but the framework absolute ceiling is 16 MiB.
- A fixed-field profile contains at most 512 fields.
- A repeating group contains at most 256 items and always declares a stricter profile maximum.
- Repeating groups have a maximum nesting depth of one in the initial version.
- Every profile declares `maxMessageBytes` within the active service ceiling.
- Every variable-length field declares a maximum byte length.
- Codec implementations validate lengths and counts before allocating buffers or arrays.
- Packing calculates and validates total wire length before allocating the output buffer.
- Unpacking validates remaining bytes before reading or allocating each field.
- Resource-limit errors expose safe profile, field, offset, limit, and actual-size metadata without payload values.

## Host Message Service

The facade provides synchronous, transport-free operations conceptually equivalent to:

```ts
interface HostMessageService {
  pack(input: PackHostMessageInput): HostMessagePackResult;
  unpack(input: UnpackHostMessageInput): HostMessageDecodeResult;
  safeSummary(message: UnpackedHostMessage): SafeHostMessageSummary;
}
```

Packing and unpacking require an exact `profileId + profileVersion + messageId` reference. The service never guesses a profile or message definition from arbitrary payload content and never mutates a repository, Flow context, UI state, logger, or transport.

## Partial Decode Policy

- Service composition accepts a project-wide `allowPartial` option whose default is false.
- Each `unpack` input accepts an optional `allowPartial` override.
- Effective behavior is `input.allowPartial ?? serviceOptions.allowPartial ?? false`.
- An explicit per-call false disables partial decoding even when the project default is true.
- Complete and partial decode outcomes use a discriminated result type and cannot be confused by type-safe callers.
- Strict decoding remains the default when neither level enables partial decoding.
- Decode results are discriminated as `complete`, `partial`, or `failed`.
- A partial result contains only fields that were fully received, decoded, and validated before input ended.
- The incomplete field value is never padded, guessed, decoded, or returned.
- A partial result identifies the safe failure position with error code, profile reference, field ID, ISO data-element number when applicable, field index, byte offset, expected bytes, received bytes, and parsing phase.
- Repeating-group failures also identify the group ID, item index, and item field ID.
- Header failures identify an MTI, bitmap, length-prefix, or equivalent non-field phase rather than inventing a field ID.
- Partial diagnostics never include the failed byte slice, decoded fragment, unrestricted hex, or a sensitive field value.
- Completely omitted profile fields may be treated as successful only when the profile explicitly declares them as allowed trailing optional fields; transport truncation does not make a required field optional.
- With partial decoding enabled, incomplete fields, field encoding failures, custom field codec failures, and declarative field validation failures may return the fully decoded leading prefix as `partial`.
- Missing or invalid profiles, unavailable registered codecs, malformed bitmap structure, undefined bitmap data elements, resource-limit violations, and internal invariants always return or raise hard failures and never expose a partial field set.

Conceptually:

```ts
type HostMessageDecodeResult =
  | { status: "complete"; message: UnpackedHostMessage }
  | {
      status: "partial";
      fields: HostFieldSet;
      failure: PartialDecodeFailure;
      consumedBytes: number;
      receivedBytes: number;
    }
  | { status: "failed"; error: HostMessageDecodeError };
```

## Error Model

- Expected packing and decoding failures use typed results rather than exceptions.
- `HostMessagePackResult` is discriminated as `packed` or `failed`.
- `HostMessageDecodeResult` is discriminated as `complete`, `partial`, or `failed`.
- Missing pack fields, overflow, invalid values, encoding failures, malformed inbound bytes, and truncation are expected typed failures.
- Profile registration errors, duplicate registry entries, missing startup contributions, and registration after freeze fail fast as configuration exceptions.
- Internal invariants may throw and are never converted into a successful or partial protocol outcome.
- Custom field codec exceptions are caught and converted to a safe `hostMessage.field.codecFailed` result without exposing their original message or cause publicly.
- Framework error categories add `protocol`; host message failures are not classified as `unknown`.
- Stable codes use the `hostMessage.*` namespace.
- Error metadata contains only safe profile, message, field, phase, offset, length, limit, and classification identifiers.

## Field Value Model

```ts
type HostFieldValue = string | Uint8Array | readonly HostFieldSet[];

type HostFieldSet = Readonly<Record<string, HostFieldValue>>;
```

- Numeric wire fields remain strings and preserve leading zeroes and arbitrary precision.
- Binary and decoded binary-coded values that are not digit strings use `Uint8Array`.
- Repeating groups contain only bounded read-only field sets.
- The service rejects numbers, bigints, dates, class instances, and arbitrary JSON objects.
- Every profile field has a stable field ID.
- An ISO 8583 field separately declares its data-element number.
- Bank-owned mappers outside the codec translate field sets to typed authorization, reversal, or other business DTOs.
- The codec does not interpret business amounts, dates, accounts, or result semantics.

## Fixed-field Codec

- Encodes fields in declared order without a bitmap.
- Interprets every configured length as wire bytes.
- Supports fixed-length ASCII, BCD, binary, UTF-8, and registered field codecs.
- Supports left and right padding with an explicit pad byte.
- Supports required fields, allowed blank values, and declarative validation.
- Supports bounded fixed-layout repeating groups.
- Supports an optional fixed total area for a repeating group.
- Requires count and item fields in repeating groups to be fixed length.
- Rejects truncated bodies, trailing bytes, invalid padding, overflow, invalid encoding, and repeat counts above profile limits.
- Excludes LLVAR, LLLVAR, message recognizer scripts, response routing, response generation, listener configuration, and simulator scripts.

## ISO 8583 Codec

- Uses application-owned ISO 8583 profiles rather than a universal production field table.
- Supports four-digit ASCII or BCD MTI.
- Supports binary or ASCII-hex primary and secondary bitmaps.
- Supports data elements 1 through 128.
- Supports fixed, LLVAR, and LLLVAR data elements.
- Supports ASCII and BCD variable-length prefixes.
- Supports bounded ASCII, BCD, binary, UTF-8, and registered field codecs.
- Rejects bitmap fields missing from the selected profile.
- Rejects profile-required fields absent from the bitmap.
- Rejects truncated bodies, trailing bytes, invalid lengths, unsupported bitmap depth, and out-of-range fields.
- Includes an ISO 8583:1987 contract fixture, not a bank production profile.
- Excludes tertiary bitmaps, EBCDIC, and ISO 8583:2003 composite elements from the initial target.

## Safety

- Every profile field declares a data classification.
- Raw bytes and complete decoded field bags remain local to the caller's operation.
- Errors contain profile, field identity, byte offset, and safe reason but never raw bytes or sensitive values.
- Safe summaries include only policy-approved masked, tokenized, presence, size, and result information.
- PAN is masked or tokenized before entering a safe summary.
- Track data, PIN data, reservation secrets, and equivalent secret values never enter safe summaries.
- PIN blocks default to presence and approved key/algorithm metadata rather than block bytes.
- Ordinary logs, traces, audit, UI, hooks, and transaction records never receive raw message data from this service.

## Application Fixtures

- Add source-controlled fixed-field and ISO 8583 fixture profiles under the kiosk example's `script/host-messages` tree.
- Add a custom field codec contribution fixture proving extension without core changes.
- Fixed-field contract vectors must be compatible with the relevant Tripley Host Simulator wire format, but the application does not load simulator configuration or scripts at runtime.
- Commit sanitized expected bytes and expected decoded fields into this repository so tests do not depend on a sibling repository or a running simulator.
- Use synthetic data and never commit real customer, PAN, Track, PIN, reservation, or bank-secret values.

## Acceptance Tests

- A fixed-field message packs to the expected bytes and unpacks back to equivalent structured values.
- Packing and unpacking are each checked against independent golden expectations; round-trip tests are supplementary rather than the sole compatibility evidence.
- Fixed fields use byte lengths correctly for multibyte and binary encodings.
- Padding, BCD, required fields, blanks, overflow, truncation, and trailing bytes are covered.
- A bounded repeating group round-trips and rejects count or area violations.
- ISO 8583 primary and secondary bitmap messages round-trip against fixed contract vectors.
- ISO fixed, LLVAR, and LLLVAR fields cover ASCII and BCD length prefixes.
- Unknown bitmap fields and malformed bitmap/length data fail with safe structured errors.
- Project-level and per-call partial-decode settings follow the documented precedence, including an explicit per-call false override.
- Partial decoding returns only complete leading fields and identifies the exact safe field or header phase where decoding stopped.
- An incomplete field's received bytes never appear as a decoded value or in error metadata.
- Field decode and validation failures return completed leading fields only when partial decoding is enabled, while profile, bitmap, registry, resource, and invariant failures never degrade to partial success.
- Exact profile version binding and frozen registry behavior are proven.
- Exact message-definition selection is proven and no implicit latest-version or MTI-based selection occurs.
- A custom field codec and a custom message codec register without modifying Host Message Service core.
- Packed BCD covers even and odd digit counts with explicit nibble padding.
- A legacy field codec fixture proves byte-vector compatibility without changing core.
- Safe summaries mask PAN and contain no Track data, PIN data, secret values, raw bytes, or unrestricted hex.
- Error text and metadata contain no sensitive field values.
- Expected pack and unpack failures return typed results and do not throw.
- Registry and profile composition errors fail fast before runtime use.
- Numeric fields with leading zeroes and values beyond JavaScript's safe integer range round-trip without loss.
- Simulator-derived fixed-field fixtures contain message bodies only and exclude transport framing prefixes.
- ISO 8583 fixtures use committed MTI, bitmap, field, and full-body byte expectations.
- Service, profile, field, repeat-count, and nesting limits reject oversized declarations and wire input before unbounded allocation.

## Out of Scope

- TCP, WebSocket, or native connection ownership.
- Message length prefixes, sticky-packet splitting, stream reassembly, or partial-frame timeout.
- HTTP/REST request execution.
- Retry, circuit breaker, request correlation, or idempotency orchestration.
- Transaction message repository writes.
- Raw message fingerprints.
- Encrypted raw message archive implementation.
- Dynamic profile loading, directory scanning, evaluated scripts, or runtime profile replacement.
- Bank authorization, reversal, advice, or withdrawal business mappings.

## Decision References

- ADR 0017: Host message codecs are independent of framing and transport.
- ADR 0018: Host message profiles are bundled application source.
- ADR 0019: Host message profiles reference registered field codecs.
- ADR 0020: ISO 8583 support is profile-driven.
- ADR 0021: Fixed-field codecs implement only wire layout.
- ADR 0022: Host message timelines store only safe projections.
- ADR 0023: Host Message Service is a pure codec boundary.
