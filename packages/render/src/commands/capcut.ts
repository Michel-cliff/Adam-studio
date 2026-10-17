import { writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { resolve } from "@adam-studio/model";
import { ensureAnalysis } from "../analysis";
import { bundleWithMedia, renderVideo } from "../engine";
import { NATIVE_FRONT_KINDS, planCapcut } from "../lib/capcut";
import { planMedia, type MediaPlan } from "../media";
import { clearPrepFolder } from "../prep-folder";
import { loadProject } from "../project-io";
import { lintGate } from "./render";

type Source = { video?: string; file?: string; width?: number; height?: number };

/** Absolute source files per asset: the CapCut exporter copies them into the CapCut project. */
export function capcutSources(plan: MediaPlan): Record<string, Source> {
  const byPublic = new Map(plan.files.map((f) => [f.to, f.from]));
  const out: Record<string, Source> = {};
  for (const [id, m] of Object.entries(plan.media)) {
    const s: Source = {};
    if (m.video) s.video = byPublic.get(m.video);
    if (m.file) s.file = byPublic.get(m.file);
    if (m.width && m.height) {
      s.width = m.width;
      s.height = m.height;
    }
    out[id] = s;
  }
  return out;
}

/** Renders what CapCut cannot do natively and writes the plan the Python exporter reads. */
export async function capcutPrepCommand(projectDir: string, opts: { out?: string; force: boolean; nativeKinds?: string[]; analyze?: boolean }): Promise<string> {
  const { dir, project, style } = loadProject(projectDir);
  const timeline = resolve(project, style);
  ensureAnalysis(dir, project, timeline, { analyze: opts.analyze ?? true });
  lintGate(project, timeline, dir, opts.force, "export");
  const media = planMedia(dir, project, timeline);
  const plan = planCapcut(timeline, opts.nativeKinds ? new Set(opts.nativeKinds) : NATIVE_FRONT_KINDS);
  const out = opts.out ? resolvePath(opts.out) : join(dir, "renders", "capcut");
  clearPrepFolder(out);
  const bakes = plan.bakes.map((b) => ({ ...b, file: `bake/${b.id}.mp4` }));
  const overlays = plan.overlays.map((o, i) => ({ ...o, file: `overlay/o${String(i + 1).padStart(2, "0")}.mov` }));
  if (bakes.length > 0 || overlays.length > 0) {
    const serveUrl = await bundleWithMedia(media, join(dir, "renders", ".bundle"));
    const base = { timeline, media: media.media, fonts: media.fonts };
    for (const b of bakes) {
      await renderVideo(serveUrl, { ...base, mode: { kind: "bake" } }, join(out, b.file), [b.fromFrame, b.toFrame - 1]);
      console.log(`baked ${b.file} (frames ${b.fromFrame} to ${b.toFrame - 1})`);
    }
    for (const o of overlays) {
      const range: [number, number] = [o.fromFrame, o.fromFrame + o.durationFrames - 1];
      await renderVideo(serveUrl, { ...base, mode: { kind: "overlay", elements: [o.elementId] } }, join(out, o.file), range, { transparent: true });
      console.log(`overlay ${o.file} for element "${o.elementId}"`);
    }
  }
  const byPublic = new Map(media.files.map((f) => [f.to, f.from]));
  const font = (key: "caption" | "title") => ({
    path: byPublic.get(media.fonts[key]),
    family: timeline.style.fonts[key].family,
    resourceId: timeline.style.fonts[key].capcutResourceId ?? null,
  });
  writeFileSync(join(out, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
  const capcutPlan = {
    name: project.name, width: timeline.width, height: timeline.height, fps: timeline.fps,
    bakes, overlays, entries: plan.entries, sources: capcutSources(media),
    nativeKinds: [...(opts.nativeKinds ?? NATIVE_FRONT_KINDS)].sort(),
    fonts: { caption: font("caption"), title: font("title") },
  };
  writeFileSync(join(out, "capcut-plan.json"), `${JSON.stringify(capcutPlan, null, 2)}\n`);
  console.log(`CapCut material ready: ${out}`);
  return out;
}
