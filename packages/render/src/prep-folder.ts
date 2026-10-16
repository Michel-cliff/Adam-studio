import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./project-io";

/** What the CapCut prepare step writes; nothing else is ever deleted from its folder. */
const PREP_ENTRIES = ["bake", "overlay", "timeline.json", "capcut-plan.json"];

/**
 * Empties the prepare folder for a new run. A folder holding anything the prepare step did not write is
 * refused untouched: `--out` may point anywhere (a renders folder, the Desktop, the project itself).
 */
export function clearPrepFolder(out: string): void {
  if (existsSync(out)) {
    const foreign = readdirSync(out).filter((f) => !PREP_ENTRIES.includes(f));
    if (foreign.length > 0) {
      throw new CliError(`Refusing to use ${out}: it holds other files (${foreign.slice(0, 3).join(", ")}). Pick an empty folder, or leave --out out to use renders/capcut.`);
    }
    for (const f of PREP_ENTRIES) rmSync(join(out, f), { recursive: true, force: true });
  }
  mkdirSync(join(out, "bake"), { recursive: true });
  mkdirSync(join(out, "overlay"), { recursive: true });
}
