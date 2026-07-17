export async function withContractTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  context: () => unknown,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(
        `Hostd contract operation timed out after ${timeoutMs}ms. State: ${JSON.stringify(context())}`,
      ));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, expired]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
