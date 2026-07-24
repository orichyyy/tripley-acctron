# Target 60: Taiwan BSP Customer Operation Bridge

## Objective

Connect the UI-facing kiosk customer-operation runtime to the Target 59 Taiwan
BSP withdrawal application without exposing sensitive acquisition material to
UI state, logs, ledgers, or generic framework contracts.

## Architecture

- Entry methods and authentication challenges remain open project
  contributions.
- Card, QR, reservation, and encrypted PIN results are captured only through an
  optional project-owned operation-material port.
- A private in-memory vault binds sensitive material to one operation ID.
- A project assembler maps that material to a complete `BspV243IwdContext`.
- The bridge converts the UI amount through an explicit currency and minor-unit
  policy before invoking Target 59.
- Generic kiosk-runtime knows no BSP fields or Taiwan project rules.

## Lifecycle

1. `withdrawal.start` admits one exclusive customer operation.
2. The selected entry contribution captures credential material in the vault.
3. Dynamic amount input and local validation run through `userInput`.
4. Required secure PIN input stores only the encrypted result in the vault.
5. The project assembler creates the BSP context immediately before execution.
6. Target 59 performs host authorization, cash delivery, custody, finalization,
   and optional Host Financial Completion.
7. The bridge projects only safe outcome facts into operation view state.
8. The vault is cleared after execution and on every earlier operation exit.

## Custody Contract

When Target 59 has already resolved card custody, the bridge updates the outer
operation custody state. Kiosk runtime treats `returned`, `retained`, and
`unknown` as terminal observations and does not issue a second card command.

## Acceptance

- The command-driven contact-card journey reaches Target 59 with dynamic amount
  and encrypted PIN material.
- The project assembler receives raw acquisition material without placing it in
  observable state.
- Target 59 card custody is not resolved a second time by kiosk runtime.
- Cancellation before business execution clears captured QR or card material.
- Operation result, UI state, logs, and diagnostics contain safe summaries only.
- A project assembler can support another entry method without modifying core.
