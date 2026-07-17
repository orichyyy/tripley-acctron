import { createRoot } from "react-dom/client";

import { createExampleApplicationRuntime, runtimeModeFromLocation } from "./runtime/create-runtime";
import { KioskApplication } from "./ui/app";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app root element.");
}

const bootstrap = async (): Promise<void> => {
  const application = await createExampleApplicationRuntime({
    mode: runtimeModeFromLocation(globalThis.location),
    onReboot: (mode) => {
      const url = new URL(globalThis.location.href);
      url.searchParams.set("mode", mode);
      globalThis.location.assign(url);
    },
  });

  createRoot(root).render(<KioskApplication application={application} />);
};

void bootstrap();
