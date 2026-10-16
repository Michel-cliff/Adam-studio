import { createHash } from "node:crypto";
import { copyFileSync, existsSync, linkSync, mkdirSync, rmSync } from "node:fs";
import { dirname, extname, isAbsolute, join } from "node:path";
import type { Project, Timeline } from "@adam-studio/model";
import { slideWindows, subjectWindows } from "./lib/subject";
import type { MediaFiles, RenderProps } from "./props";

export class MediaError extends Error {}

export type MediaPlan = {
  files: { from: string; to: string }[];
  media: Record<string, MediaFiles>;
  fonts: RenderProps["fonts"];
};

/** %LOCALAPPDATA%-style variables, as written in styles (e.g. CapCut's font cache). Unknown ones are kept. */
export function expandEnv(path: string): string {
  return path.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}

export function planMedia(projectDir: string, project: Project, timeline: Timeline, opts: { preview?: boolean } = {}): MediaPlan {
  const files = new Map<string, string>(); // public path -> source path
  const media: Record<string, MediaFiles> = {};
  const missing: string[] = [];
  const assets = new Map(project.assets.map((a) => [a.id, a]));
  const at = (p: string) => {
    const expanded = expandEnv(p);
    return isAbsolute(expanded) ? expanded : join(projectDir, expanded);
  };
  const add = (asset: string, key: keyof MediaFiles, from: string, to: string, step: string) => {
    if (!existsSync(from)) {
      missing.push(`${to} for asset "${asset}" (${step})`);
      return;
    }
    files.set(to, from);
    media[asset] = { ...media[asset], [key]: to };
  };
  const cache = (asset: string, file: string) => join(projectDir, "cache", asset, file);

  const videoAssets = new Set<string>();
  for (const c of timeline.clips) {
    videoAssets.add(c.asset);
    if (c.framing.mode === "split") videoAssets.add(c.framing.asset);
  }
  for (const id of videoAssets) {
    // Previews read the half-resolution proxy when the analysis made one; exports always read edit.mp4.
    const proxy = cache(id, "proxy.mp4");
    if (opts.preview && existsSync(proxy)) add(id, "video", proxy, `cache/${id}/proxy.mp4`, "run the variants analysis step");
    else add(id, "video", cache(id, "edit.mp4"), `cache/${id}/edit.mp4`, "run the variants analysis step");
    const meta = assets.get(id)?.meta;
    if (meta?.width && meta.height) media[id] = { ...media[id], width: meta.width, height: meta.height };
  }

  for (const id of new Set(subjectWindows(timeline).map((w) => w.asset))) {
    add(id, "subject", cache(id, "subject.webm"), `cache/${id}/subject.webm`, "run the matting analysis step");
  }
  const clipAsset = new Map(timeline.clips.map((c) => [c.id, c.asset]));
  for (const id of new Set(slideWindows(timeline).map((w) => clipAsset.get(w.clipId)!))) {
    add(id, "plate", cache(id, "plate.png"), `cache/${id}/plate.png`, "run the clean plate analysis step");
  }

  const fileAssets = new Set<string>();
  for (const e of timeline.elements) if (e.kind === "image") fileAssets.add(String(e.props.asset));
  for (const a of timeline.audio) if (!videoAssets.has(a.asset)) fileAssets.add(a.asset);
  for (const id of fileAssets) {
    const asset = assets.get(id);
    if (!asset) {
      missing.push(`asset "${id}" is not declared in the project`);
      continue;
    }
    add(id, "file", at(asset.path), `assets/${id}${extname(asset.path)}`, "check the asset path");
  }

  // Named after the source file, so review variants with different fonts can share one public dir.
  const fontName = (key: "caption" | "title") => {
    const from = at(timeline.style.fonts[key].file);
    return { from, to: `fonts/${key}-${createHash("sha1").update(from).digest("hex").slice(0, 8)}${extname(from)}` };
  };
  const caption = fontName("caption");
  const title = fontName("title");
  const fonts = { caption: caption.to, title: title.to };
  for (const [key, f] of [["caption", caption], ["title", title]] as const) {
    if (existsSync(f.from)) files.set(f.to, f.from);
    else missing.push(`font file ${timeline.style.fonts[key].file} (${key} font of the style)`);
  }

  if (missing.length) throw new MediaError(`Missing files:\n- ${missing.join("\n- ")}`);
  return { files: [...files].map(([to, from]) => ({ from, to })), media, fonts };
}

/** Recreates the public dir with hard links to the planned files (copies when linking is not possible). */
export function prepareMedia(plan: MediaPlan, publicDir: string): void {
  rmSync(publicDir, { recursive: true, force: true });
  for (const { from, to } of plan.files) {
    const dest = join(publicDir, to);
    mkdirSync(dirname(dest), { recursive: true });
    try {
      linkSync(from, dest);
    } catch {
      copyFileSync(from, dest);
    }
  }
}

export function mergePlans(plans: MediaPlan[]): MediaPlan {
  const files = new Map<string, string>();
  const media: Record<string, MediaFiles> = {};
  for (const p of plans) {
    for (const f of p.files) files.set(f.to, f.from);
    for (const [id, m] of Object.entries(p.media)) media[id] = { ...media[id], ...m };
  }
  return { files: [...files].map(([to, from]) => ({ from, to })), media, fonts: plans[0]!.fonts };
}
