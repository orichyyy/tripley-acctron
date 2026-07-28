export interface InputSourceProgress {
  readonly kind: string;
  readonly activity: boolean;
  readonly safeSummary: Readonly<Record<string, unknown>>;
}

export interface InputSourceProgressSubscription {
  unsubscribe(): void;
}

export interface InputSourceProgressStream {
  subscribe(
    listener: (progress: InputSourceProgress) => void,
  ): InputSourceProgressSubscription;
}

export interface ReplayableInputSourceProgress
  extends InputSourceProgressStream {
  publish(progress: InputSourceProgress): void;
  close(): void;
}

export const createReplayableInputSourceProgress =
  (): ReplayableInputSourceProgress => {
    const listeners = new Set<(progress: InputSourceProgress) => void>();
    let latest: InputSourceProgress | undefined;
    let closed = false;

    return {
      close: () => {
        closed = true;
        listeners.clear();
      },
      publish: (progress) => {
        if (closed) {
          return;
        }
        latest = progress;
        for (const listener of listeners) {
          notifyProgressListener(listener, progress);
        }
      },
      subscribe: (listener) => {
        if (latest) {
          notifyProgressListener(listener, latest);
        }
        if (!closed) {
          listeners.add(listener);
        }
        return {
          unsubscribe: () => {
            listeners.delete(listener);
          },
        };
      },
    };
  };

const notifyProgressListener = (
  listener: (progress: InputSourceProgress) => void,
  progress: InputSourceProgress,
): void => {
  try {
    listener(progress);
  } catch {
    // Presentation observers cannot alter input command control.
  }
};
