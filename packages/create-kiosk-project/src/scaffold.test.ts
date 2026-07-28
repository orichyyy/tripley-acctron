import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createKioskProject } from "./node-scaffold";
import { planKioskProjectScaffold } from "./scaffold";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("create kiosk project", () => {
  it("plans a canonical project-root AGENTS.md", () => {
    const plan = planKioskProjectScaffold("./bank-kiosk");

    expect(plan.files).toEqual([
      { overwrite: false, relativePath: "AGENTS.md" },
    ]);
  });

  it("materializes the packaged core-first instructions", async () => {
    const target = await temporaryDirectory();

    const result = await createKioskProject(target);
    const agents = await readFile(join(target, "AGENTS.md"), "utf8");

    expect(result.createdFiles).toEqual([join(target, "AGENTS.md")]);
    expect(agents).toContain("# Core-First Kiosk Architecture");
    expect(agents).toContain("apps/kiosk-example");
  });

  it("refuses to overwrite existing project instructions by default", async () => {
    const target = await temporaryDirectory();
    await writeFile(join(target, "AGENTS.md"), "project rules", "utf8");

    await expect(createKioskProject(target)).rejects.toMatchObject({
      code: "scaffold.target.exists",
    });
  });

  it("overwrites only when force is explicit", async () => {
    const target = await temporaryDirectory();
    await writeFile(join(target, "AGENTS.md"), "obsolete", "utf8");

    await createKioskProject(target, { force: true });

    await expect(
      readFile(join(target, "AGENTS.md"), "utf8"),
    ).resolves.toContain("# Core-First Kiosk Architecture");
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tripley-kiosk-project-"));
  temporaryDirectories.push(directory);
  return directory;
}
