# Target 61: Taiwan BSP v2.43 Operation Context Assembler

## Status

Implemented.

## Purpose

Provide the Taiwan BSP project layer that turns kiosk operation material into a
validated `BspV243IwdContext`. The assembler is the boundary between device and
UI material, project configuration, bank security services, and the existing
BSP v2.43 wire projector.

The design follows the shared request header in the legacy
`RequestHeader.xml`, the common ICI field order in the BSP v2.43 specification,
and the existing fixed-field profile. It does not move bank-specific parsing or
security policy into framework core.

## Modules

- `operation-context-contracts.ts` defines project ports, mapper contracts,
  safe errors, terminal configuration, and the assembled result.
- `credential-mapper-registry.ts` resolves an open credential mapper by
  `entryMethodId` and rejects ambiguous registrations.
- `xfs-idc-credential-mapper.ts` validates structural XFS IDC results and
  exposes successful card data by configurable source number.
- `operation-context-assembler.ts` constructs the BSP header and ICI fields,
  applies amount and date policy, requires secure PIN data, and invokes the
  project security port.

## Security boundary

The assembler accepts the encrypted PIN block only from a `securePin` input
result. It never accepts clear PIN text. XFS track bytes, account values, PIN
blocks, terminal checks, and MAC values are present only in the trusted
assembly/security path.

Safe metadata contains only:

- credential entry method ID
- credential mapper ID
- credential mapper version

`BspOperationContextError` serializes only a stable error code and field ID.
The error does not retain or serialize the rejected field value.

ATM check and MAC values must come from `BspRequestSecurityPort`. There is no
fallback value and no production cryptographic algorithm in the framework.

## Extensibility

Contact-card support is an adapter registered through
`BspCredentialMapperRegistry`. XFS data source numbers and successful status
values are adapter configuration rather than BSP assembler constants. A bank
project supplies the resolver that maps its Track/EMV representation to BSP
account and chip fields.

QR or reservation withdrawal is not implicitly treated as IWD. A project may
register a cardless mapper when its host contract explicitly uses this message.
Projects using BSP NWD/NWF should contribute the corresponding message profile
and mapper instead. No core change is required in either case.

## Fail-fast rules

Assembly fails before host I/O when:

- no mapper exists for the assessed entry method
- captured credential and assessment entry methods disagree
- XFS IDC data is malformed or a required source is unavailable
- a mapper-required BSP field is absent
- secure PIN input is missing or is not a 16-character encrypted block
- terminal dates, sequence, currency, or amount cannot fit the protocol
- the security provider returns an invalid ATM check or MAC

`amountMultiplier` is explicit and defaults to `1`. A project must configure a
different multiplier when its UI amount unit differs from the host field unit.

## Verification

Tests cover:

- the shared header values and fixed ICI prefix against a deterministic BSP
  v2.43 golden vector
- XFS IDC source decoding and contact-card projection
- secure PIN and security result projection
- fail-fast missing PIN behavior before the security port is called
- safe failure and metadata serialization
- a project-owned cardless mapper registered without framework modification
