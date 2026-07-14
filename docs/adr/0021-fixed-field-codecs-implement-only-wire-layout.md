# Fixed-field codecs implement only wire layout

The initial fixed-field codec consumes and emits fields in declared order using byte lengths, bounded encodings, padding, validation, and optional bounded fixed-layout repeating groups. It requires an explicitly selected request or response profile and deliberately excludes LLVAR/LLLVAR fields, dynamic recognizers, response routing/building, listener configuration, and scripts because those belong to ISO profiles, host operations, transports, or simulator behavior rather than this wire codec.
