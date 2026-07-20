# Protection config v2 has no legacy runtime compatibility

The internal-development release replaces the single `disconnectAction` schema with an explicit version-2 configuration containing allowlisted Protection Policy Profiles and exhaustive phase action matrices. Hostd rejects legacy configuration with migration guidance, lease acquisition requires a profile ID, and clients, examples, and simulator smokes move together; hostd does not infer profiles, inject implicit intervention decisions, or carry a runtime compatibility path whose behavior would be unsafe and ambiguous.
