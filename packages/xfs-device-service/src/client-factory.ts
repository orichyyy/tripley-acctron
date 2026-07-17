import { createWebSocketXfsClient } from "@tripley-kit/xfs-client";

import type { XfsRuntimeClientFactory } from "./types";

export const createTripleyKitXfsRuntimeClient: XfsRuntimeClientFactory = (options) =>
  createWebSocketXfsClient({
    ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
    commandLeasing: options.requiredModules.includes("cdm") ? "required" : "optional",
    requiredModules: options.requiredModules as NonNullable<Parameters<
      typeof createWebSocketXfsClient
    >[0]["requiredModules"]>,
    url: options.url,
  });
