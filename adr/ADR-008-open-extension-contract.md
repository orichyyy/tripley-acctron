# ADR-008 Open Extension Contract

## Decision

Core must expose open registries and must not use closed enums or hardcoded switches for project-extensible kinds. Built-ins register through the same path as plugins.

## Consequences

- New input devices can be supported without core modification.
- New flow node kinds, effects, conditions, repositories, config providers, and UI contributions can be added by plugins.
- Contract tests are required for extension adapters.
