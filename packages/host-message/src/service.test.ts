import type { HostMessageCodec, HostMessageProfile } from "./contracts";
import { describe, expect, it } from "vitest";
import { createHostMessageService } from "./service";
import { fixedProfile, reverseAsciiCodec } from "./test-fixtures";

describe("HostMessageService", () => {
  it("freezes registries and binds exact profile versions", () => {
    const runtime = createHostMessageService({ profiles: [fixedProfile] });
    expect(() => runtime.profiles.register(fixedProfile)).toThrow(/frozen/i);
    const result = runtime.service.pack({
      reference: { profileId: fixedProfile.id, profileVersion: "2", messageId: "authorization.request" },
      fields: {},
    });
    expect(result.status).toBe("failed");
  });

  it("registers a custom field codec without changing core", () => {
    const profile: HostMessageProfile = {
      id: "fixture.custom-field",
      version: "1",
      codecId: "fixed-field",
      maxMessageBytes: 8,
      fieldDefinitions: [{
        id: "legacy",
        dataClassification: "public",
        encoding: { kind: "custom", codecId: reverseAsciiCodec.id, codecVersion: reverseAsciiCodec.version },
        length: { kind: "fixed", bytes: 3 },
      }],
      messages: [{ id: "request", direction: "request", fields: [{ kind: "field", fieldId: "legacy", presence: "required" }] }],
    };
    const { service } = createHostMessageService({ profiles: [profile], fieldCodecs: [reverseAsciiCodec] });
    const reference = { profileId: profile.id, profileVersion: profile.version, messageId: "request" };
    const packed = service.pack({ reference, fields: { legacy: "ABC" } });
    expect(packed.status).toBe("packed");
    if (packed.status === "packed") expect(new TextDecoder().decode(packed.message.bytes)).toBe("CBA");
  });

  it("registers a custom message codec without modifying service orchestration", () => {
    const codec: HostMessageCodec = {
      id: "fixture.echo",
      pack(context) {
        return { status: "packed", message: { reference: context.reference, bytes: new Uint8Array([0x45]) } };
      },
      unpack(context) {
        return { status: "complete", message: { reference: context.reference, fields: { echo: "E" }, wireLength: context.bytes.length } };
      },
    };
    const profile: HostMessageProfile = {
      id: "fixture.echo",
      version: "1",
      codecId: codec.id,
      maxMessageBytes: 1,
      fieldDefinitions: [],
      messages: [{ id: "echo", direction: "request", fields: [] }],
    };
    const { service } = createHostMessageService({ profiles: [profile], messageCodecs: [codec] });
    expect(service.pack({ reference: { profileId: profile.id, profileVersion: "1", messageId: "echo" }, fields: {} }).status).toBe("packed");
  });

  it("produces safe summaries without PAN or PIN block material", () => {
    const { service } = createHostMessageService({ profiles: [fixedProfile] });
    const reference = { profileId: fixedProfile.id, profileVersion: "1", messageId: "secure.request" };
    const packed = service.pack({
      reference,
      fields: { messageType: "P", account: "1234", pinBlock: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
    });
    expect(packed.status).toBe("packed");
    if (packed.status !== "packed") return;
    const decoded = service.unpack({ reference, bytes: packed.message.bytes });
    expect(decoded.status).toBe("complete");
    if (decoded.status !== "complete") return;
    const serialized = JSON.stringify(service.safeSummary(decoded.message));
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("01020304");
    expect(serialized).toContain("**34");
  });

  it("rejects profiles above the service ceiling", () => {
    expect(() => createHostMessageService({ profiles: [{ ...fixedProfile, id: "too-large", maxMessageBytes: 65 * 1024 }] })).toThrow(/limit/i);
  });
});
