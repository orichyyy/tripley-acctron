import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

export interface ReactRootBoundary {
  render(node: ReactNode): void;
  unmount(): void;
}

export type ReactRootFactory = (
  container: Element | DocumentFragment,
) => ReactRootBoundary;

export interface ReactWindowRootOptions {
  readonly factory?: ReactRootFactory | undefined;
  readonly windowKey?: string | undefined;
}

export interface ReactWindowRoot {
  render(node: ReactNode): void;
  dispose(): void;
}

export const createReactWindowRoot = (
  container: Element | DocumentFragment,
  options: ReactWindowRootOptions = {},
): ReactWindowRoot => {
  const root = (options.factory ?? defaultRootFactory)(container);
  let disposed = false;
  return {
    render: (node) => {
      if (disposed) {
        throw new FrameworkError({
          category: "configuration",
          code: "react.root.disposed",
          message: `React root is already disposed: ${options.windowKey ?? "unknown"}`,
        });
      }
      root.render(node);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      root.unmount();
    },
  };
};

const defaultRootFactory: ReactRootFactory = (container) => createRoot(container);
