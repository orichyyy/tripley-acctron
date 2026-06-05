# @tripley-acctron/host

Host Gateway runtime for Tripley Acctron.

Update this document when host contracts, gateway behavior, codecs, mappers, or transports change.

## Gateway

`DefaultHostGateway` sends canonical host requests through an injected transport, codec, and mapper.
It tracks in-flight requests by request id and supports timeout and abort cleanup.

## Defaults

`JsonHostCodec` serializes raw messages as JSON strings.
`IdentityHostMessageMapper` maps canonical messages directly and is intended for tests, demos, and
simple JSON hosts.

## Command Dispatch

`createHostCommandHandler` adapts inbound canonical `HostCommand` messages to
`service.applyHostCommand` on the runtime command bus. Gateway transport and wire mapping remain
separate from service state policy.
