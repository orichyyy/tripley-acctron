# ISO 8583 support is profile-driven

The initial ISO 8583 engine supports a four-digit ASCII or BCD MTI, binary or ASCII-hex primary and secondary bitmaps, fields 1 through 128, fixed/LLVAR/LLLVAR data elements, ASCII or BCD length prefixes, and bounded ASCII, BCD, binary, or UTF-8 values. An ISO 8583:1987 profile is a contract fixture rather than a universal production field table; bank applications own production profiles, while tertiary bitmaps, EBCDIC, and ISO 8583:2003 composite elements remain explicit future extensions.
