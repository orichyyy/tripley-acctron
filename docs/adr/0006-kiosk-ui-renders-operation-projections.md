# Kiosk UI renders operation projections instead of controlling Flow

The React example renders a safe operation view state through the Zustand-backed UI port and invokes behavior only through commands. Flow nodes are not routes, React components never own device or Flow sessions, and React Router is limited to application-level kiosk and diagnostics pages; leaving the kiosk interrupts active work rather than navigating transaction history. This preserves the framework boundary and makes browser navigation incapable of bypassing Flow lifecycle and cleanup policy.
