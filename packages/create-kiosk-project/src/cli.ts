import { createKioskProject } from "./node-scaffold";
import { KioskProjectScaffoldError } from "./scaffold";

const usage = `Usage: create-kiosk-project <target-directory> [--force]

Initializes a kiosk project with the canonical Tripley Acctron AGENTS.md.

Options:
  --force  Overwrite an existing AGENTS.md
  --help   Show this help
`;

async function main(args: readonly string[]): Promise<number> {
  if (args.includes("--help")) {
    process.stdout.write(usage);
    return 0;
  }

  const force = args.includes("--force");
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const unknownOptions = args.filter(
    (argument) => argument.startsWith("--") && argument !== "--force",
  );

  if (unknownOptions.length > 0 || positional.length !== 1) {
    process.stderr.write(usage);
    return 1;
  }

  try {
    const result = await createKioskProject(positional[0]!, { force });
    process.stdout.write(
      `Initialized kiosk project governance at ${result.rootDirectory}\n`,
    );
    return 0;
  } catch (error) {
    const message =
      error instanceof KioskProjectScaffoldError ||
      error instanceof Error
        ? error.message
        : "Unknown kiosk project scaffold error.";
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
