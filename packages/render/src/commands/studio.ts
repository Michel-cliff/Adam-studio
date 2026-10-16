import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { resolve } from "@adam-studio/model";
import { ensureAnalysis } from "../analysis";
import { ENTRY } from "../engine";
import { planMedia, prepareMedia } from "../media";
import { loadProject } from "../project-io";

/** The Remotion CLI script, run with node directly: no shell, so paths with spaces stay intact. */
function remotionCli(): string {
  const pkgPath = createRequire(import.meta.url).resolve("@remotion/cli/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: Record<string, string> };
  return join(dirname(pkgPath), pkg.bin.remotion!);
}

/** Opens Remotion Studio on the project: the preview until the web app exists. */
export function studioCommand(projectDir: string, opts: { analyze?: boolean } = {}): void {
  const { dir, project, style } = loadProject(projectDir);
  const timeline = resolve(project, style);
  ensureAnalysis(dir, project, timeline, { analyze: opts.analyze ?? true });
  const plan = planMedia(dir, project, timeline, { preview: true });
  const publicDir = join(dir, "renders", ".public");
  prepareMedia(plan, publicDir);
  const propsFile = join(dir, "renders", "studio-props.json");
  writeFileSync(propsFile, JSON.stringify({ timeline, media: plan.media, fonts: plan.fonts }));
  spawnSync(process.execPath, [remotionCli(), "studio", ENTRY, "--public-dir", publicDir, "--props", propsFile], {
    cwd: join(dirname(ENTRY), ".."),
    stdio: "inherit",
  });
}
