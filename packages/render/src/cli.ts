import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { capcutPrepCommand } from "./commands/capcut";
import { decideCommand } from "./commands/decide";
import { addCommand, analyzeCommand, newCommand } from "./commands/new";
import { renderCommand } from "./commands/render";
import { reviewCommand } from "./commands/review";
import { stillCommand } from "./commands/still";
import { studioCommand } from "./commands/studio";
import { CliError } from "./project-io";

// `npm run adam` runs from the repo root; relative paths are meant from where the command was typed.
const base = process.env.INIT_CWD ?? process.cwd();

const USAGE = `usage: npm run adam -- <command> <projectDir> [options]
  render <dir> [--out file.mp4] [--frames a-b] [--force]
  review <dir> [--step <step>]
  decide <dir> <proposalId> <A|B|C|reject|more> [--note "..."]
  studio <dir>
  still <dir> --at 500,1500 [--variant p1:B]
  capcut-prep <dir> [--out folder] [--force]
  new <dir> <videos...> [--lang fr] [--format 9:16|16:9] [--style style.json] [--name name]
  add <dir> <videos...> [--lang fr]
  analyze <dir> [--assets c01,c02] [--steps subject,plate] [--force]
  (render, review, studio and capcut-prep take --no-analyze)`;

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
      lang: { type: "string" },
      format: { type: "string" },
      style: { type: "string" },
      name: { type: "string" },
      assets: { type: "string" },
      steps: { type: "string" },
      "no-analyze": { type: "boolean" },
      at: { type: "string" },
      variant: { type: "string" },
    },
  });
  const [cmd, dirArg, ...rest] = positionals;
  if (!cmd || !dirArg) throw new CliError(USAGE);
  const dir = resolve(base, dirArg);
  switch (cmd) {
    case "new":
      newCommand(dir, rest.map((v) => resolve(base, v)), { lang: values.lang, format: values.format, style: values.style ? resolve(base, values.style) : undefined, name: values.name });
      return;
    case "add":
      addCommand(dir, rest.map((v) => resolve(base, v)), { lang: values.lang });
      return;
    case "analyze":
      analyzeCommand(dir, { assets: values.assets, steps: values.steps, force: values.force ?? false, lang: values.lang });
      return;
    case "render":
      await renderCommand(dir, { out: values.out ? resolve(base, values.out) : undefined, frames: values.frames, force: values.force ?? false, analyze: !values["no-analyze"] });
      return;
    case "review":
      await reviewCommand(dir, { step: values.step, analyze: !values["no-analyze"] });
      return;
    case "decide": {
      const [id, decision] = rest;
      if (!id || !decision) throw new CliError(USAGE);
      decideCommand(dir, id, decision, values.note);
      return;
    }
    case "capcut-prep":
      await capcutPrepCommand(dir, { out: values.out ? resolve(base, values.out) : undefined, force: values.force ?? false, analyze: !values["no-analyze"] });
      return;
    case "still": {
      const at = (values.at ?? "").split(",").filter(Boolean).map(Number);
      if (at.length === 0 || at.some((n) => !Number.isFinite(n))) throw new CliError("still needs --at <ms>[,<ms>...]");
      await stillCommand(dir, { at, variant: values.variant, analyze: !values["no-analyze"] });
      return;
    }
    case "studio":
      studioCommand(dir, { analyze: !values["no-analyze"] });
      return;
    default:
      throw new CliError(USAGE);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
