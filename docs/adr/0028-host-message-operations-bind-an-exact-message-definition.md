# Host message operations bind an exact message definition

A Host Message Profile versions one protocol family and contains shared field declarations plus explicit request, response, and advice message definitions. Every pack or unpack operation binds `profileId + profileVersion + messageId`; registration flattens permitted declarations into immutable definitions, and runtime code never guesses by MTI or payload content, resolves a latest version, or performs inheritance.
