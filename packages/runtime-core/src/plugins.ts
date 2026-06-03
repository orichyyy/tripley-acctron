import { createServiceToken, type Plugin } from "@tripley-acctron/plugin-system";
import { ServiceStateController } from "./service-state.js";

export const serviceStateToken =
  createServiceToken<ServiceStateController>("runtime.service-state");

export function createServiceStatePlugin(): Plugin {
  return {
    name: "runtime.service-state",
    setup: ({ services }) => {
      services.register(serviceStateToken, new ServiceStateController());
    },
  };
}
