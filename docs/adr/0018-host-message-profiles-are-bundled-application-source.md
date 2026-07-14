# Host message profiles are bundled application source

Host message profiles live in the kiosk application repository's `script` source tree and are statically imported and registered by the application composition root. The framework does not scan deployment directories, load profile scripts from disk, evaluate downloaded code, or replace profiles in a running runtime; changing a profile requires building and deploying a new application version, which favors reviewability and deterministic transaction behavior over host-simulator-style runtime editing.
