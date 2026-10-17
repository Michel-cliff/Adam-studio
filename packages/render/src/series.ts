import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { applySeries, parseSeries, parseStyle, resolve, type Series, type SeriesInput } from "@adam-studio/model";
import { CliError, formatErrors, loadProject, saveProject } from "./project-io";

export function seriesRoot(): string {
  return process.env.ADAM_SERIES ?? join(homedir(), "AdamStudioSeries");
}

export function listSeries(): { name: string; dir: string; error?: string }[] {
  const root = seriesRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "series.json")))
    .map((d) => {
      try { loadSeries(d.name); return { name: d.name, dir: join(root, d.name) }; } catch (e) { return { name: d.name, dir: join(root, d.name), error: (e as Error).message }; }
    });
}

export function loadSeries(name: string): { series: Series; dir: string } {
  if (!name || /[\/:*?"<>|]/.test(name) || name === "." || name === "..") throw new CliError(`not a valid series name: "${name}"`);
  const dir = join(seriesRoot(), name);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(join(dir, "series.json"), "utf8")); } catch (e) { throw new CliError(`no series "${name}" in ${seriesRoot()} (${(e as Error).message})`); }
  const s = parseSeries(raw);
  if (!s.ok) throw new CliError(formatErrors(`${name}/series.json`, s.errors));
  return { series: s.value, dir };
}

/** Applies a series to a project: series style, assets and treatment elements (validated before writing). */
export function applySeriesTo(projectDir: string, name: string): void {
  const { dir, project } = loadProject(projectDir);
  const { series, dir: sdir } = loadSeries(name);
  const next = applySeries(project, series, sdir);
  const stylePath = isAbsolute(next.style) ? next.style : join(dir, next.style);
  const style = parseStyle(JSON.parse(readFileSync(stylePath, "utf8")));
  if (!style.ok) throw new CliError(formatErrors(stylePath, style.errors));
  resolve(next, style.value);
  saveProject(dir, next);
  console.log(`${dir}: series "${name}" applied (${next.elements.filter((e) => e.id.startsWith("series.")).length} series elements)`);
}

/**
 * Starts a series from a project: its style (font paths made absolute), the images and sounds its elements
 * use (copied into the series), and its elements anchored at 0 ms as the start treatment.
 */
export function saveSeries(projectDir: string, name: string): string {
  const { dir, project, style } = loadProject(projectDir);
  loadSeriesName(name);
  const sdir = join(seriesRoot(), name);
  if (existsSync(join(sdir, "series.json"))) throw new CliError(`series "${name}" exists: edit ${join(sdir, "series.json")} instead`);
  mkdirSync(join(sdir, "assets"), { recursive: true });
  const abs = (p: string) => (isAbsolute(p) || p.startsWith("%") ? p : join(dir, p));
  const fonts = Object.fromEntries(Object.entries(style.fonts).map(([k, f]) => [k, { ...f, file: abs(f.file) }]));
  writeFileSync(join(sdir, "style.json"), `${JSON.stringify({ ...style, fonts }, null, 2)}\n`);
  const used = new Set(project.elements.map((e) => e.props.asset).filter((a): a is string => typeof a === "string"));
  const assets = project.assets.filter((a) => a.kind !== "video" && used.has(a.id)).map((a) => {
    const file = `${a.id}-${basename(a.path)}`;
    copyFileSync(abs(a.path), join(sdir, "assets", file));
    return { ...a, path: `assets/${file}` };
  });
  const start = project.elements.filter((e) => "atMs" in e.anchor && e.anchor.atMs === 0).map((e) => {
    const { anchor: _anchor, ...rest } = e;
    return rest;
  });
  const series: SeriesInput = { version: 1, name, style: "style.json", assets, vars: {}, treatments: { start: start as never, transition: [], beat: [], end: [] } };
  writeFileSync(join(sdir, "series.json"), `${JSON.stringify(series, null, 2)}\n`);
  console.log(`series "${name}" saved in ${sdir}: style, ${assets.length} assets, ${start.length} start elements`);
  return sdir;
}

function loadSeriesName(name: string): void {
  if (!name || /[\/:*?"<>|]/.test(name) || name === "." || name === "..") throw new CliError(`not a valid series name: "${name}"`);
}
