import type { JournalEntry, StepHandler } from "@tripley-acctron/contracts";
import {
  type TestKioskAppOptions,
  VirtualClock,
  createFakeDevices,
  createTestKioskApp,
} from "@tripley-acctron/testing";

export function createStandardStepTestKit(
  steps: Record<string, StepHandler>,
  options: Pick<TestKioskAppOptions, "logger" | "tts" | "voiceGuide"> = {},
) {
  const devices = createFakeDevices();
  const clock = new VirtualClock();
  const appOptions: TestKioskAppOptions = {
    steps,
    devices,
    clock,
    ...options,
    flows: [
      {
        id: "demo",
        version: "1",
        nodes: [
          { id: "start", type: "start" },
          { id: "input", type: "action", action: "input" },
          { id: "valid", type: "end", name: "Valid" },
          { id: "cancelled", type: "end", name: "Cancelled" },
          { id: "timeout", type: "end", name: "Timeout" },
          { id: "saving", type: "end", name: "Saving" },
          { id: "checking", type: "end", name: "Checking" },
          { id: "confirmed", type: "end", name: "Confirmed" },
          { id: "approved", type: "end", name: "Approved" },
          { id: "declined", type: "end", name: "Declined" },
          { id: "done", type: "end", name: "Done" },
          { id: "failed", type: "end", name: "Failed" },
        ],
        edges: [
          { id: "start-input", from: "start", to: "input" },
          { id: "valid", from: "input", to: "valid", route: "Valid" },
          { id: "cancelled", from: "input", to: "cancelled", route: "Cancelled" },
          { id: "timeout", from: "input", to: "timeout", route: "Timeout" },
          { id: "saving", from: "input", to: "saving", route: "Saving" },
          { id: "checking", from: "input", to: "checking", route: "Checking" },
          { id: "confirmed", from: "input", to: "confirmed", route: "Confirmed" },
          { id: "approved", from: "input", to: "approved", route: "Approved" },
          { id: "declined", from: "input", to: "declined", route: "Declined" },
          { id: "done", from: "input", to: "done", route: "Done" },
          { id: "failed", from: "input", to: "failed", route: "Failed" },
        ],
      },
    ],
  };
  const kit = createTestKioskApp(appOptions);
  return { ...kit, devices, clock };
}

export function journalEntries(kit: ReturnType<typeof createStandardStepTestKit>): JournalEntry[] {
  return (kit.journal as unknown as { entries: JournalEntry[] }).entries;
}

export async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
