export * from "@tripley/web-container-errors";
export * from "@tripley/web-container-registry";
export * from "@tripley/web-container-types";
export * from "@tripley/web-container-utils";

export interface FrameworkPackage {
  readonly name: string;
  readonly version: string;
}

export const corePackage: FrameworkPackage = {
  name: "@tripley/web-container-core",
  version: "0.1.0",
};
