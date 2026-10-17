import { applyPatch, resolve, type Project } from "@adam-studio/model";
import { planMedia } from "@adam-studio/render/src/media";
import type { MediaFiles } from "@adam-studio/render/src/props";
import { load, ToolError } from "./store";

const plans = new Map<string, Map<string, string>>(); // project dir -> public path -> file on disk

function applied(project: Project, apply: { proposal: string; variant: "A" | "B" | "C" }): Project {
  const v = project.proposals.find((p) => p.id === apply.proposal)?.variants.find((x) => x.key === apply.variant);
  if (!v) throw new ToolError(`no variant ${apply.variant} in ${apply.proposal}`);
  return applyPatch(project, v.patch);
}

/** What the live preview needs: the timeline, and media and fonts as URLs served by the panel. */
export function previewData(dir: string, name: string, apply?: { proposal: string; variant: "A" | "B" | "C" }) {
  const loaded = load(dir);
  const style = loaded.style;
  const project = apply ? applied(loaded.project, apply) : loaded.project;
  let timeline;
  try { timeline = resolve(loaded.project, style, apply ? { apply } : {}); } catch (e) { throw new ToolError((e as Error).message); }
  let plan;
  try { plan = planMedia(dir, project, timeline, { preview: true }); } catch (e) { throw new ToolError(`${(e as Error).message}
Run Analyze first.`); }
  const known = plans.get(dir) ?? new Map<string, string>();
  for (const f of plan.files) known.set(f.to, f.from);
  plans.set(dir, known);
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
