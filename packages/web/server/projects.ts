import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseProject } from "@adam-studio/model";
import type { CacheState, ProjectListItem, ProjectView, ProposalView, RenderView, TakeView } from "./types";

type Raw = Record<string, any>;
const CHEAP = ["edit", "proxy", "transcript", "silences"] as const;
const FILES: Record<string, string> = { edit: "edit.mp4", proxy: "proxy.mp4", transcript: "transcript.json", silences: "silences.json", subject: "subject.webm", plate: "plate.png" };

function readProject(dir: string): { raw: Raw | null; error?: string } {
  let raw: Raw;
  try { raw = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")); } catch (e) { return { raw: null, error: `project.json does not parse: ${(e as Error).message}` }; }
  const parsed = parseProject(raw);
  if (!parsed.ok) return { raw, error: parsed.errors.map((e) => `${e.path}: ${e.message}`).join("\n") };
  return { raw };
}

function renders(dir: string): RenderView[] {
  const folder = join(dir, "renders");
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((f) => f.toLowerCase().endsWith(".mp4"))
    .map((f) => { const s = statSync(join(folder, f)); return { file: `renders/${f}`, size: s.size, mtime: s.mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);
}

export function listProjects(root: string): ProjectListItem[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "project.json")))
    .map((d) => {
      const dir = join(root, d.name);
      const { raw, error } = readProject(dir);
      const r = renders(dir);
      return { name: d.name, ok: !error, ...(error ? { error } : {}), format: raw?.canvas?.format, takes: Array.isArray(raw?.assets) ? raw.assets.length : 0, lastRender: r[0]?.mtime ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function take(dir: string, raw: Raw, a: Raw): TakeView {
  const cache = join(dir, "cache", a.id);
  const has = (step: string) => existsSync(join(cache, FILES[step]!));
  const state: Record<string, CacheState> = {};
  for (const s of CHEAP) state[s] = has(s) ? "done" : "missing";
  for (const s of ["subject", "plate"]) state[s] = has(s) ? "done" : "on demand";
  let durationMs: number | null = null;
  try { durationMs = JSON.parse(readFileSync(join(cache, "probe.json"), "utf8")).durationMs ?? null; } catch { /* not analyzed yet */ }
  const words: Raw[] = raw.transcript?.words?.[a.id] ?? [];
  return { id: a.id, file: basename(String(a.path)), durationMs, firstWords: words.slice(0, 12).map((w) => w.text).join(" "), cache: state };
}

function proposal(dir: string, p: Raw): ProposalView {
  const status = typeof p.status === "object" && p.status?.accepted ? `accepted ${p.status.accepted}` : String(p.status ?? "pending");
  const folder = `renders/review/${p.id}`;
  let review: ProposalView["review"] = null;
  try {
    const index = JSON.parse(readFileSync(join(dir, folder, "index.json"), "utf8"));
    review = {
      sheet: existsSync(join(dir, folder, "sheet.jpg")) ? `${folder}/sheet.jpg` : null,
      clips: Object.fromEntries((index.variants ?? []).map((v: Raw) => [v.key, `${folder}/${v.preview}`])),
    };
  } catch { /* no review rendered */ }
  return { id: p.id, step: p.step, status, ...(p.reason ? { reason: p.reason } : {}), variants: (p.variants ?? []).map((v: Raw) => ({ key: v.key, label: v.label ?? "" })), review };
}

export function projectView(root: string, name: string): Omit<ProjectView, "jobs"> | null {
  const dir = join(root, name);
  if (!existsSync(join(dir, "project.json"))) return null;
  const { raw, error } = readProject(dir);
  const assets: Raw[] = Array.isArray(raw?.assets) ? raw.assets.filter((a: Raw) => a.kind === "video") : [];
  return {
    name, ok: !error, ...(error ? { error } : {}), format: raw?.canvas?.format,
    takes: raw ? assets.map((a) => take(dir, raw, a)) : [],
    renders: renders(dir),
    proposals: Array.isArray(raw?.proposals) ? raw.proposals.map((p: Raw) => proposal(dir, p)) : [],
  };
}
