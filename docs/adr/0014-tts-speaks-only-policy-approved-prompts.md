# TTS speaks only policy-approved catalog prompts

Flow and UI request speech by catalog prompt ID with schema-validated safe parameters rather than unrestricted text. Speech intents are bound to operation-view revisions, deduplicated, and cancelled with node or operation lifecycle; TTS is optional in ordinary visual operation but becomes a required capability when the selected accessibility profile requires it. This keeps accessibility extensible without turning TTS or React components into paths for leaking credentials and device errors.
