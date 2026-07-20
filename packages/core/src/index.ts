export * from "@tripley-kit/web-container-errors";
export * from "@tripley-kit/web-container-registry";
export * from "@tripley-kit/web-container-types";
export * from "@tripley-kit/web-container-utils";

export interface FrameworkPackage {
  readonly name: string;
  readonly version: string;
}

export const corePackage: FrameworkPackage = {
  name: "@tripley-kit/web-container-core",
  version: "0.1.0",
};
