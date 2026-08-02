import type {
  ObservableUiPort,
  UiStateScope,
} from "@tripley-kit/web-container-ui-port";
import { useSyncExternalStore } from "react";

export const useUiState = <T = unknown>(
  ui: ObservableUiPort,
  scope: UiStateScope,
  key: string,
): T | undefined => {
  useSyncExternalStore(
    (listener) => ui.subscribe(listener),
    () => ui.getRevision(),
    () => ui.getRevision(),
  );
  return ui.getState<T>(scope, key);
};
