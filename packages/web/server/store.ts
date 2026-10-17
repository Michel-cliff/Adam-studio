import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  applyPatch, closeStep, decide, deepMerge, lint, parseProject, parseStyle, PatchSchema, ProposalSchema, resolve,
  type Decision, type Plain, type Project, type Style, type Timeline,
} from "@adam-studio/model";
import { cutWords, tightenPauses } from "./cuts";
import { safeName } from "./guards";

export class ToolError extends Error {}

const KEEP_BACKUPS = 50;

/** A project by name (inside the projects root) or by absolute path. */
export function projectDir(ref: string, root: string): string {
  const dir = isAbsolute(ref) ? ref : safeName(ref) ? join(root, ref) : null;
  if (!dir || !existsSync(join(dir, "project.json"))) throw new ToolError(`no project "${ref}" (projects folder: ${root})`);
  return dir;
}

function errors(file: string, list: { path: string; message: string }[]): ToolError {
  return new ToolError(`${file} would be invalid:\n${list.map((e) => `- ${e.path}: ${e.message}`).join("\n")}`);
}

export function loadRaw(dir: string): Plain {
  try { return JSON.parse(readFileSync(join(dir, "project.json"), "utf8")); } catch (e) { throw new ToolError(`project.json does not parse: ${(e as Error).message}`); }
}

export function load(dir: string): { project: Project; style: Style } {
  const p = parseProject(loadRaw(dir));
  if (!p.ok) throw errors("project.json", p.errors);
  const stylePath = isAbsolute(p.value.style) ? p.value.style : join(dir, p.value.style);
  let rawStyle: unknown;
  try { rawStyle = JSON.parse(readFileSync(stylePath, "utf8")); } catch (e) { throw new ToolError(`cannot read ${p.value.style}: ${(e as Error).message}`); }
  const s = parseStyle(rawStyle);
  if (!s.ok) throw errors(p.value.style, s.errors);
  return { project: p.value, style: s.value };
}

export function lintLines(dir: string, project: Project, timeline: Timeline): string[] {
  return lint(project, timeline, { projectDir: dir, fileExists: existsSync }).map((w) => `${w.severity === "error" ? "ERROR" : "warn"} ${w.rule}: ${w.message}`);
}

const historyDir = (dir: string) => join(dir, "renders", ".history");

/** Validates (schema and resolve), keeps a backup of the current file, writes, and returns the lint lines. */
export function save(dir: string, input: unknown): { lint: string[]; durationMs: number } {
  const p = parseProject(input);
  if (!p.ok) throw errors("project.json", p.errors);
  const { style } = load(dir);
  let timeline: Timeline;
  try { timeline = resolve(p.value, style); } catch (e) { throw new ToolError(`the edit would not resolve: ${(e as Error).message}`); }
  const hist = historyDir(dir);
  mkdirSync(hist, { recursive: true });
  copyFileSync(join(dir, "project.json"), join(hist, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  const old = readdirSync(hist).filter((f) => f.endsWith(".json")).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) rmSync(join(hist, f));
  writeFileSync(join(dir, "project.json"), `${JSON.stringify(input, null, 2)}\n`);
  return { lint: lintLines(dir, p.value, timeline), durationMs: Math.round((timeline.durationFrames * 1000) / timeline.fps) };
}

/** Puts back the project.json from before the last change made through these tools. */
export function undo(dir: string): string {
  const hist = historyDir(dir);
  const backups = existsSync(hist) ? readdirSync(hist).filter((f) => f.endsWith(".json")).sort() : [];
  const last = backups.at(-1);
  if (!last) throw new ToolError("nothing to undo");
  copyFileSync(join(hist, last), join(dir, "project.json"));
  rmSync(join(hist, last));
  return `restored the version saved at ${last.replace(".json", "")} (${backups.length - 1} more to undo)`;
}

export function edit(dir: string, fn: (p: Project) => Project) {
  return save(dir, fn(load(dir).project));
}

export function patchProject(dir: string, patch: unknown) {
  const p = PatchSchema.safeParse(patch);
  if (!p.success) throw new ToolError(`not a valid patch: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return edit(dir, (project) => { try { return applyPatch(project, p.data); } catch (e) { throw new ToolError((e as Error).message); } });
}

/** Deep-merges changes into the story clip or element with this id (arrays and scalars replace). */
export function updateItem(dir: string, collection: "story" | "elements", id: string, changes: Plain) {
  if ("id" in changes && changes.id !== id) throw new ToolError("an id cannot be changed: remove the item and add a new one");
  const raw = loadRaw(dir);
  const list = raw[collection];
  if (!Array.isArray(list)) throw new ToolError(`the project has no ${collection}`);
  const i = list.findIndex((x: Plain) => x.id === id);
  if (i < 0) throw new ToolError(`no ${collection === "story" ? "clip" : "element"} "${id}" (ids: ${list.map((x: Plain) => x.id).join(", ")})`);
  list[i] = deepMerge(list[i], changes);
  return save(dir, raw);
}

/** Sets (or, with value undefined, removes) the value at a JSON Pointer such as /captions/0/text. */
export function setValue(dir: string, pointer: string, value: unknown) {
  if (!pointer.startsWith("/")) throw new ToolError(`a JSON Pointer starts with "/", got "${pointer}"`);
  const keys = pointer.slice(1).split("/").map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
  const raw = loadRaw(dir);
  let node: any = raw;
  for (const k of keys.slice(0, -1)) {
    if (node === null || typeof node !== "object" || !(k in node)) throw new ToolError(`nothing at ${pointer} ("${k}" is missing)`);
    node = node[k];
  }
  const last = keys.at(-1)!;
  if (value === undefined) {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete node[last];
  } else if (Array.isArray(node) && last === "-") node.push(value);
  else node[last] = value;
  return save(dir, raw);
}

/** Adds a proposal, or gives new variants to one the creator sent back with "more". */
export function propose(dir: string, input: unknown) {
  const p = ProposalSchema.safeParse(input);
  if (!p.success) throw new ToolError(`not a valid proposal: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const proposal = p.data;
  if (proposal.variants.length === 0) throw new ToolError("a proposal needs one to three variants");
  return edit(dir, (project) => {
    const i = project.proposals.findIndex((x) => x.id === proposal.id);
    if (i < 0) return { ...project, proposals: [...project.proposals, { ...proposal, status: "pending", history: [] }] };
    const old = project.proposals[i]!;
    if (old.status !== "pending" || old.variants.length > 0) {
      throw new ToolError(`proposal "${proposal.id}" exists and is ${old.status === "pending" ? "waiting for a decision" : "decided"}: use another id`);
    }
    const next = { ...old, variants: proposal.variants, reason: proposal.reason || old.reason, anchor: proposal.anchor ?? old.anchor };
    return { ...project, proposals: project.proposals.map((x, j) => (j === i ? next : x)) };
  });
}

export function decideProposal(dir: string, id: string, decision: Decision, note?: string) {
  return edit(dir, (project) => { try { return decide(project, id, decision, note); } catch (e) { throw new ToolError((e as Error).message); } });
}

export function closeCurrentStep(dir: string) {
  return edit(dir, (project) => { try { return closeStep(project); } catch (e) { throw new ToolError((e as Error).message); } });
}

export function cutWordsIn(dir: string, words: string[]) {
  return edit(dir, (p) => { try { return cutWords(p, words); } catch (e) { throw new ToolError((e as Error).message); } });
}

export function tightenIn(dir: string, minPauseMs: number, keepMs: number) {
  return edit(dir, (p) => { try { return tightenPauses(p, minPauseMs, keepMs); } catch (e) { throw new ToolError((e as Error).message); } });
}
