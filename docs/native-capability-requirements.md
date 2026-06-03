# Tripley Native Capability Requirements

The existing Tripley Native IDL provides filesystem, archive, TCP, WebSocket, SQLite, runtime, and
system power capabilities. The kiosk foundation needs the following additions in
`E:\code\rust\tripley-native`. After the IDL is updated, regenerate and consume the
`@tripley-kit/native` client. Do not add direct Tauri, Electron, or WebView2 bridge calls here.

## Required Services

### WindowService

- Create, close, focus, and enumerate windows.
- Include stable window ID and role metadata such as `kiosk` or `supervisor`.
- Allow the host policy to constrain which roles and URLs may be opened.

### WindowMessageService

- Send a structured message to a selected window.
- Broadcast a structured message.
- Subscribe to inbound messages with sender window metadata.

### ElectronicJournalService

- Append a structured journal entry.
- Flush pending records.
- Preserve timestamp, stable event ID, trace ID, and safe structured data.

## Future Device Services

Native TTS, pinpad, card reader, cash dispenser, cash acceptor, receipt printer, and document modules
should be added as separate IDL services when device integration begins.

