# Host message data failures use typed results

Expected host-message packing and decoding problems return discriminated typed outcomes, including an explicit partial decode state, while profile/registry composition errors and internal invariants remain fail-fast exceptions. The framework adds a `protocol` error category and stable `hostMessage.*` codes so malformed host data is handled deliberately without being mislabeled as unknown or leaking raw codec exceptions.
