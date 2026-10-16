import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { renderCommand } from "./commands/render";
import { CliError } from "./project-io";

// `npm run adam` runs from the repo root; relative paths are meant from where the command was typed.
const base = process.env.INIT_CWD ?? process.cwd();

const USAGE = `usage: npm run adam -- <command> <projectDir> [options]
  render <dir> [--out file.mp4] [--frames a-b] [--force]`;

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      frames: { type: "string" },
      force: { type: "boolean" },
      step: { type: "string" },
      note: { type: "string" },
    },
  });
  const [cmd, dirArg] = positionals;
  if (!cmd || !dirArg) throw new CliError(USAGE);
  const dir = resolve(base, dirArg);
  switch (cmd) {
    case "render":
      await renderCommand(dir, { out: values.out ? resolve(base, values.out) : undefined, frames: values.frames, force: values.force ?? false });
      return;
    default:
      throw new CliError(USAGE);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
