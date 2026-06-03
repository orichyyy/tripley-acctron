import { useSyncExternalStore } from "react";
import type { UiRuntimeSnapshot, UiRuntimeStore } from "./react-ui-adapter";

export function useUiRuntime(store: UiRuntimeStore): UiRuntimeSnapshot {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
}
