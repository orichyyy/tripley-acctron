# @tripley-acctron/recipes

Business-level step recipes for common ATM flows.

- `Recipes.inputAccount` expands to a text input step and stores the accepted value in `ctx.transaction`.
- `Recipes.waitCardInserted` waits for `ctx.devices.cardReader.waitForCard`.
- `Recipes.ejectCard` ejects the card and routes taken/retained/failed outcomes.

Recipes depend only on contracts and the standard step kit. Native device support must still come through the device contracts backed by `tripley-native` adapters.
