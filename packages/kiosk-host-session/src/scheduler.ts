import type { HostSessionScheduler } from "./contracts";

export const systemHostSessionScheduler: HostSessionScheduler = {
  now: () => Date.now(),
  schedule(delayMs, callback) {
    const timer = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(timer) };
  },
};
