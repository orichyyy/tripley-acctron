# Strong Rule

If a requested change would cause a file to become too large, mix unrelated responsibilities, or introduce hard-to-maintain code, refactor the code into smaller, clearer modules before adding the feature.

# Core-First Kiosk Architecture

## Reference Application

- Treat the Tripley Acctron `apps/kiosk-example` application as the architectural reference for kiosk project composition.
- Follow its use of packages, registries, ports, adapters, contributions, runtime assembly, lifecycle practices, and testing seams unless a documented project requirement needs a project-specific extension.
- A bank project consumes and extends Tripley Acctron. It must not become an alternative kiosk framework.

## Mandatory Core Reuse

- Before implementing a capability locally, identify the corresponding `@tripley-kit/web-container-*` package and use its public interface.
- Prefer existing ports, registries, policies, adapters, contributions, flow definitions, commands, and configuration.
- Do not copy, fork, shadow, or locally reimplement core behavior for convenience or delivery speed.
- Do not access low-level native, XRPC, or XFS clients directly when a Tripley Acctron module already owns that responsibility.
- Do not create project-local alternatives for flow execution, command dispatch, conditions, UI abstraction, device registration and locking, input orchestration, timeout and interrupt handling, recovery, host delivery, transaction lifecycle, scoped state, audit, diagnostics, or idempotency.

## Capability Ownership Decision

Classify every missing capability before implementation:

1. Existing core capability: consume and configure the existing package.
2. Reusable capability: implement or improve it in Tripley Acctron, including its public interface, tests, documentation, and `apps/kiosk-example` usage, then consume the updated package.
3. Project-specific capability: implement it in this project through an existing core extension seam.

- A capability is reusable when another bank, country, device vendor, host protocol, or kiosk project could reasonably need it.
- When ownership is uncertain, do not default to a local implementation. Make the ownership decision explicit before writing code.
- Record significant ownership and seam decisions in the project `docs` directory as ADRs.

## Core Gap Workflow

When Tripley Acctron cannot satisfy a reusable requirement:

1. Describe the missing behavior and intended core seam.
2. Implement the smallest coherent enhancement in the Tripley Acctron repository.
3. Add focused tests for the public behavior.
4. Update the relevant core documentation.
5. Update `apps/kiosk-example` with an executable reference integration.
6. Commit and publish every affected package according to the core repository release rules.
7. Update this project's package versions and integrate only through published public interfaces.

- Do not use copied source, private package internals, deep imports, permanent patches, or project-local framework substitutes.
- Do not put bank-specific message formats, business rules, assets, translations, flows, or vendor behavior into core packages.

## Flow and UI Separation

- Express business and transaction orchestration through Flow Engine definitions, node executors, subflows, policies, hooks, effects, and registered extensions.
- Commands may explicitly start or signal flows. UI implementations must not become transaction state machines.
- UI implementations render projections and submit user intent through configured command or input interfaces.
- UI code must not decide business transitions, own device sessions, manage transaction cancellation, post host messages, perform card or cash disposition, print receipts, reset transaction scope, or coordinate transaction cleanup.
- UI mount, unmount, rerender, routing, and development behavior must not control transaction lifetime.
- Project UI state must be projected through the core UI abstraction rather than maintained as a parallel workflow.

## Project Extension Rules

- Keep bank-specific host profiles, response classifications, error resolution, receipt mappings, transaction availability rules, localized prompts, assets, flow definitions, and vendor adapters in the project.
- Register project-specific node kinds, conditions, commands, input sources, devices, routes, menus, guards, and policies through core registries and contribution interfaces.
- Integrate device vendors behind reusable device or native seams. If the seam can serve another project, add it to core before adding the project adapter.
- Project extensions must be replaceable without modifying core package internals.
- Any project-local framework-like abstraction requires a written explanation of why core is insufficient and why the abstraction is genuinely project-specific.

## Code Organization

- Keep presentation, domain policy, orchestration, data access, external integration, configuration, validation, error handling, and tests in focused modules.
- Keep business logic framework-independent where practical.
- Place side effects at system edges.
- Avoid circular dependencies and global mutable state.
- Prefer dependency injection and explicit parameters over hidden dependencies.
- Keep functions short and purpose-driven. Prefer early returns over deeply nested control flow.

## Architecture Review Gate

Before completing a feature, verify:

- The implementation follows the `apps/kiosk-example` composition style.
- Existing core packages were reused where applicable.
- Reusable gaps were implemented in core rather than hidden in the project.
- UI code contains presentation logic only.
- Flow Engine owns sequencing, timeout, interrupt, cancellation, recovery, and cleanup.
- Device and host operations cross registered ports or adapters.
- Project-specific behavior remains outside core.
- Core enhancements include tests, documentation, and an updated reference example.
- Project tests cover project configuration and extensions without duplicating core tests.

If a feature would violate these rules, refactor toward the core architecture before implementing it.
