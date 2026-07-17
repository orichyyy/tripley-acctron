export async function runAbortableXfsCommand<T>(options: {
  readonly cancel: () => Promise<void>;
  readonly execute: () => Promise<T>;
  readonly signal?: AbortSignal | undefined;
}): Promise<T> {
  const { signal } = options;
  if (!signal) return options.execute();
  if (signal.aborted) throw abortError(signal);

  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      void options.cancel().then(
        () => reject(abortError(signal)),
        (error: unknown) => reject(error),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([options.execute(), cancelled]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

const abortError = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(String(signal.reason ?? "XFS command aborted."));
  error.name = "AbortError";
  return error;
};
