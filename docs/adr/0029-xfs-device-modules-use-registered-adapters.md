# XFS device modules use registered adapters

XFS Device Service owns transport, manager startup, logical-service sessions, and disposal, while each IDC, PIN, BCR, CDM, or future module contributes port construction, device metadata, health/status behavior, input sources, and cancellation through an XFS Device Module Adapter registry. Existing oversized shared port/type files are split before CDM is added, preventing every new module from extending a central branch chain and mixing unrelated device responsibilities.
