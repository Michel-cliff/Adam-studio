import { resolve } from "@adam-studio/model";
import { planMedia } from "@adam-studio/render/src/media";
import type { MediaFiles } from "@adam-studio/render/src/props";
import { load, ToolError } from "./store";

const plans = new Map<string, Map<string, string>>(); // project dir -> public path -> file on disk

/** What the live preview needs: the timeline, and media and fonts as URLs served by the panel. */
export function previewData(dir: string, name: string) {
  const { project, style } = load(dir);
  let timeline;
  try { timeline = resolve(project, style); } catch (e) { throw new ToolError((e as Error).message); }
  let plan;
  try { plan = planMedia(dir, project, timeline, { preview: true }); } catch (e) { throw new ToolError(`${(e as Error).message}
Run Analyze first.`); }
  plans.set(dir, new Map(plan.files.map((f) => [f.to, f.from])));
  const url = (to: string) => `/api/projects/${encodeURIComponent(name)}/media/${to.split("/").map(encodeURIComponent).join("/")}`;
  const media: Record<string, MediaFiles> = {};
  for (const [id, m] of Object.entries(plan.media)) {
    media[id] = { ...m };
    for (const k of ["video", "subject", "plate", "file"] as const) if (m[k]) media[id]![k] = url(m[k]!);
  }
  return { timeline, media, fonts: { caption: url(plan.fonts.caption), title: url(plan.fonts.title) } };
}

/** The file behind a preview media path (planned by the last previewData call for this project). */
export function mediaFile(dir: string, name: string, to: string): string | null {
  if (!plans.get(dir)?.has(to)) { try { previewData(dir, name); } catch { return null; } }
  return plans.get(dir)?.get(to) ?? null;
}
