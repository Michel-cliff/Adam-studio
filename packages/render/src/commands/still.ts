import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { applyPatch, resolve, type VariantKey } from "@adam-studio/model";
import { ensureAnalysis } from "../analysis";
import { bundleWithMedia, renderFrame } from "../engine";
import { planMedia } from "../media";
import { CliError, loadProject } from "../project-io";

/** Renders single frames of the edit (or of a proposal's variant, "p1:B") as PNG; returns the files. */
export async function stillCommand(projectDir: string, opts: { at: number[]; variant?: string; analyze?: boolean }): Promise<string[]> {
  const { dir, project, style } = loadProject(projectDir);
  let applied = project;
  let apply: { proposal: string; variant: VariantKey } | undefined;
  if (opts.variant) {
    const m = /^([^:]+):(A|B|C)$/.exec(opts.variant);
    if (!m) throw new CliError(`--variant expects proposal:key (e.g. p1:B), got "${opts.variant}"`);
    apply = { proposal: m[1]!, variant: m[2] as VariantKey };
    const p = project.proposals.find((x) => x.id === apply!.proposal);
    const v = p?.variants.find((x) => x.key === apply!.variant);
    if (!v) throw new CliError(`no variant ${opts.variant} in the project`);
    applied = applyPatch(project, v.patch);
  }
  const timeline = resolve(project, style, apply ? { apply } : {});
  const frames = opts.at.map((ms) => {
    const f = Math.round((ms * timeline.fps) / 1000);
    if (ms < 0 || f >= timeline.durationFrames) throw new CliError(`${ms} ms is past the end of the edit (${Math.round((timeline.durationFrames * 1000) / timeline.fps)} ms)`);
    return f;
  });
  ensureAnalysis(dir, applied, timeline, { analyze: opts.analyze ?? true });
  const plan = planMedia(dir, applied, timeline);
  const serveUrl = await bundleWithMedia(plan, join(dir, "renders", ".bundle"));
  const folder = join(dir, "renders", "stills");
  mkdirSync(folder, { recursive: true });
  const out: string[] = [];
  for (const [i, frame] of frames.entries()) {
    const file = join(folder, `${opts.variant ? opts.variant.replace(":", "-") : "edit"}-${opts.at[i]}ms.png`);
    await renderFrame(serveUrl, { timeline, media: plan.media, fonts: plan.fonts }, frame, file);
    console.log(`wrote ${file}`);
    out.push(file);
  }
  return out;
}
