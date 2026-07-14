# Host message codecs are independent of framing and transport

Host message codecs encode and decode versioned wire representations, message framing finds complete byte bodies, and host transports or API adapters own communication semantics. REST/JSON integration therefore uses a Host API Adapter rather than pretending to be an ISO 8583 codec; this separation allows fixed-field and bitmap ISO 8583 profiles to share delivery mechanisms without coupling fields to TCP, WebSocket, or HTTP behavior.
