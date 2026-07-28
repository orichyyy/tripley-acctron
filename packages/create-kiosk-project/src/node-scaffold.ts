import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import canonicalAgentInstructions from "../templates/AGENTS.md";

import {
  KioskProjectScaffoldError,
  planKioskProjectScaffold,
} from "./scaffold";

export interface CreateKioskProjectOptions {
  readonly force?: boolean | undefined;
  readonly templatePath?: string | undefined;
}

export interface CreateKioskProjectResult {
  readonly rootDirectory: string;
  readonly createdFiles: readonly string[];
}

export async function createKioskProject(
  targetDirectory: string,
  options: CreateKioskProjectOptions = {},
): Promise<CreateKioskProjectResult> {
  const plan = planKioskProjectScaffold(targetDirectory, options);
  const template = options.templatePath
    ? await readTemplate(options.templatePath)
    : canonicalAgentInstructions;
  const createdFiles: string[] = [];

  await mkdir(plan.rootDirectory, { recursive: true });
  for (const file of plan.files) {
    const destination = join(plan.rootDirectory, file.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeScaffoldFile(destination, template, file.overwrite);
    createdFiles.push(destination);
  }

  return { createdFiles, rootDirectory: plan.rootDirectory };
}

async function readTemplate(templatePath: string): Promise<string> {
  try {
    return await readFile(templatePath, "utf8");
  } catch (error) {
    throw new KioskProjectScaffoldError(
      "scaffold.template.unavailable",
      `Unable to read the kiosk project template: ${templatePath}`,
      { cause: error },
    );
  }
}

async function writeScaffoldFile(
  destination: string,
  content: string,
  overwrite: boolean,
): Promise<void> {
  try {
    await writeFile(destination, content, {
      encoding: "utf8",
      flag: overwrite ? "w" : "wx",
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new KioskProjectScaffoldError(
        "scaffold.target.exists",
        `Refusing to overwrite existing file: ${destination}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}
