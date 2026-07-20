# Next Target: XFS Device Service Validation

## Decision

The next target is not a new feature. It is validation and hardening of `packages/xfs-device-service`.

## Why this is next

The package now exists, but it has not been installed, typechecked, built, or tested in the workspace after adding the local `@tripley-kit/xfs-client` dependency. Continuing to kiosk example integration or simulator test harness before this validation would compound unknowns.

## Target outcome

Make `packages/xfs-device-service` a verified package in the workspace.

## Required checks

- Run dependency installation so the local Tripley Kit dependency is represented in the lockfile.
- Typecheck `@tripley-kit/web-container-xfs-device-service`.
- Run the package unit tests.
- Build the package.
- Run full workspace typecheck if targeted checks pass.

## Expected fixes

Likely hardening areas:

- `exactOptionalPropertyTypes` object construction.
- Type compatibility between Tripley Kit XFS module names and the framework `XfsRequiredModule` type.
- The local file dependency shape for `@tripley-kit/xfs-client`.
- Secure PIN result typing.
- Fake client test typing.
- Package export and tsup declaration generation.

## Acceptance criteria

- `pnpm install` completes.
- `pnpm --filter @tripley-kit/web-container-xfs-device-service typecheck` passes.
- `pnpm vitest run packages/xfs-device-service/src/xfs-device-service.test.ts` passes.
- `pnpm --filter @tripley-kit/web-container-xfs-device-service build` passes.
- No Flow Engine, UserInput executor, or core device abstraction changes are needed for validation.

## What this unlocks

After this target passes, the next feature target should be hostd-backed kiosk example integration or an `xfs-test-harness` package, depending on whether the real hostd smoke has passed locally.
