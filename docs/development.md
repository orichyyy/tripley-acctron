# Development

Install dependencies and run all validation:

```sh
pnpm install
pnpm check
```

The repository uses Biome for formatting, linting, and import organization. Runtime packages are
private workspace libraries until their contracts stabilize. `@tripley-kit/logger` is consumed from
npm. Native container integration will consume the generated `@tripley-kit/native` package after
the required IDL services are available.

