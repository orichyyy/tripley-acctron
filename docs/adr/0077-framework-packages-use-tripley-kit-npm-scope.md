# ADR 0077: Framework packages use the Tripley Kit npm scope

## Status

Accepted.

## Context

The framework packages were initially named `@tripley/web-container-*`, while the npm credentials and existing native/XFS libraries belong to the `@tripley-kit` organization. npm permissions are scope-specific: the release owner can publish `@tripley-kit/*` but cannot publish `@tripley/*`. Keeping both scopes would also split one product ecosystem across two ownership and release boundaries.

## Decision

All framework packages use the `@tripley-kit/web-container-*` npm identity.

Package manifests, workspace dependencies, TypeScript imports, examples, configuration, documentation, and lockfile references move together. Because the framework is still in internal development and no `@tripley/web-container-*` package was published, the migration is breaking and provides no compatibility aliases or forwarding packages.

## Consequences

- Native, XFS, and web-container packages share the npm organization already owned by the project.
- Publishing and access control use one organization and token policy.
- Consumers must import only `@tripley-kit/web-container-*` names.
- Future public package changes require a version bump, commit, and npm publish after validation.
