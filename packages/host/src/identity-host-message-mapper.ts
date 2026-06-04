import type { CanonicalHostMessage, HostMessageMapper } from "@tripley-acctron/contracts";

export class IdentityHostMessageMapper implements HostMessageMapper<CanonicalHostMessage> {
  public toCanonical(raw: CanonicalHostMessage): CanonicalHostMessage {
    return raw;
  }

  public fromCanonical(message: CanonicalHostMessage): CanonicalHostMessage {
    return message;
  }
}
