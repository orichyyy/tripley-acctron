# @tripley-acctron/accessibility

Accessibility services for TTS and prerecorded voice prompts.

- `NoopTtsService` is the safe default for tests/headless runs.
- `BrowserSpeechSynthesisTtsService` wraps browser `speechSynthesis`.
- `DefaultVoiceGuideService` resolves audio assets and plays them through an injected `AudioPlayer`.

Voice guide assets resolve to `assets/audios/{lang}/{key}.mp3` by default.
