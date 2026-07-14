# Host message service is a pure codec boundary

The first Host Message Service is an in-memory deep module for profile resolution, packing, unpacking, validation, and safe summaries. Network transports, stream framing, HTTP APIs, resilience, transaction recording, and encrypted archives compose around this module later rather than becoming codec side effects, which keeps wire behavior deterministic and independently testable.
