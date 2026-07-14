# Legacy field codecs require golden byte vectors

Host Message Service directly guarantees only deterministic ASCII, UTF-8, packed BCD, raw binary, and ASCII-hex behavior across browser and Node runtimes. Legacy code pages and private byte transformations are versioned static Field Codec Contributions and are considered supported only when golden byte vectors prove their behavior; runtime default encodings and guessed platform decoder behavior are never part of the contract.
