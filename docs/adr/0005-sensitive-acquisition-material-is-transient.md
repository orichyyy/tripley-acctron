# Sensitive acquisition material is transient and non-observable

Raw card and QR material may exist only inside acquisition and immediate business verification, after which the Flow receives a safe access credential or a safe validation failure. It is excluded from scoped state, ledgers, audit, UI, traces, logs, and hook payloads; secure PIN remains device-contained and exposes only a PIN block or safe result. This avoids introducing a secret vault in the first vertical slice while preventing generic framework observability and extension seams from becoming data-exfiltration paths.
