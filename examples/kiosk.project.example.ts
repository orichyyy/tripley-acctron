import { createKioskRuntime } from "@tripley/web-container-kiosk-base";

export const kioskProject = createKioskRuntime({
  appId: "bank-kiosk-app",
  projectId: "bank-kiosk-project",
  requiredNativeCapabilities: [
    "runtime",
    "fs",
    "archive",
    "sqlite",
    "window.openWindow",
    "window.setAlwaysOnTop",
    "window.minimizeWindow",
    "display.listDisplays",
  ],
  configuration: {
    providerOrder: ["cli", "env", "sqlite", "json", "defaults"],
    jsonFiles: ["/config/project.json"],
    sqlitePath: "/data/kiosk-config.db",
  },
  logging: {
    filename: "/logs/app_{{yyyyMMdd}}.log",
    level: { dev: "DEBUG", prod: "INFO" },
    rolling: { interval: "day", maxFiles: 14, compression: true },
  },
  windows: {
    topology: "multi-screen",
    windowMode: "dedicated-root-per-display",
    rootWindows: {
      customer: {
        windowKey: "kiosk.customer",
        path: "/customer/idle",
        displayRole: "front",
        launch: "onBoot",
      },
      admin: { windowKey: "kiosk.admin", path: "/admin", displayRole: "rear", launch: "onDemand" },
      advertising: {
        windowKey: "kiosk.advertising",
        path: "/advertising",
        displayRole: "top",
        launch: "onBoot",
      },
    },
  },
  plugins: [],
});
