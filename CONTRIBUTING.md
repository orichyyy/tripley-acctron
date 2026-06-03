# Contributing

- Keep business logic, contracts, infrastructure, and future UI adapters in separate modules.
- Keep source files near 300 lines and split responsibilities before they approach 500 lines.
- Register dependencies through constructors or the plugin service registry.
- Do not swallow errors. Record them with a stable dotted `eventId`, then rethrow or recover.
- Run `pnpm check` before submitting changes.
- Update `CHANGELOG.md` for every feature, important update, or fix. Update package documentation when
  behavior or public contracts change.

