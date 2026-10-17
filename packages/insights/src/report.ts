import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Project } from "@adam-studio/model";
import type { Video } from "./platforms";

const FILE = join(homedir(), ".adam-studio", "insights.json");

/** Fetched videos and the creator's links between a video and the Adam Studio project it came from. */
export type InsightsData = { fetchedAt: Record<string, string>; videos: Video[]; links: Record<string, string> };
const key = (v: Pick<Video, "platform" | "id">) => `${v.platform}:${v.id}`;

export function readInsights(file = FILE): InsightsData {
  try { return { fetchedAt: {}, videos: [], links: {}, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { return { fetchedAt: {}, videos: [], links: {} }; }
}

export function writeInsights(d: InsightsData, file = FILE): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(d, null, 1));
}

/** Replaces one platform's videos with a fresh fetch, keeping links. */
export function mergeVideos(d: InsightsData, platform: Video["platform"], videos: Video[]): InsightsData {
  return { ...d, fetchedAt: { ...d.fetchedAt, [platform]: new Date().toISOString() }, videos: [...d.videos.filter((v) => v.platform !== platform), ...videos] };
}

export function link(d: InsightsData, video: string, project: string | null): InsightsData {
  const links = { ...d.links };
  if (project) links[video] = project;
  else delete links[video];
  return { ...d, links };
}

/** What an edit is made of, from its project: length, pacing, hook, structure, effects. */
export type Features = {
  durationS: number; cutsPerMin: number; hookS: number | null; framework: string | null; series: string | null;
  elements: Record<string, number>; captions: boolean; wordsPerMin: number;
};

export function features(p: Project): Features {
  const durMs = p.story.reduce((s, c) => s + (c.outMs - c.inMs), 0);
  const kept = p.story.flatMap((c) => (p.transcript.words[c.asset] ?? []).filter((w) => w.startMs >= c.inMs && w.endMs <= c.outMs));
  const hook = p.structure?.beats.find((b) => /hook|accroche|curiosity/i.test(b.role));
  let hookS: number | null = null;
  if (hook) {
    const end = Object.values(p.transcript.words).flat().find((w) => w.id === hook.to);
    const first = p.story[0];
    if (end && first) hookS = Math.max(0, (end.endMs - first.inMs) / 1000);
  }
  const elements: Record<string, number> = {};
  for (const e of p.elements) elements[e.kind] = (elements[e.kind] ?? 0) + 1;
  const seriesStyle = /[\\/]AdamStudioSeries[\\/]([^\\/]+)[\\/]/.exec(p.style)?.[1] ?? null;
  return {
    durationS: Math.round(durMs / 100) / 10,
    cutsPerMin: durMs ? Math.round(((p.story.length - 1) / (durMs / 60000)) * 10) / 10 : 0,
    hookS: hookS === null ? null : Math.round(hookS * 10) / 10,
    framework: p.structure?.framework ?? null,
    series: seriesStyle,
    elements,
    captions: p.captions.length > 0 || kept.length > 0,
    wordsPerMin: durMs ? Math.round(kept.length / (durMs / 60000)) : 0,
  };
}

export const engagement = (v: Video) => (v.views ? (v.likes + v.comments + v.shares + v.saves) / v.views : 0);

export type Row = Video & { key: string; engagement: number; project: string | null; features: Features | null };

/** Videos ranked by views, each with its engagement rate and, when linked, the features of its edit. */
export function rank(d: InsightsData, featuresOf: (project: string) => Features | null): Row[] {
  return d.videos
    .map((v) => {
      const project = d.links[key(v)] ?? null;
      return { ...v, key: key(v), engagement: Math.round(engagement(v) * 10000) / 10000, project, features: project ? featuresOf(project) : null };
    })
    .sort((a, b) => b.views - a.views);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

/**
 * For each feature, the linked videos split in two groups (above and below the feature's median, or by value for
 * text features) with their median views and engagement: where an edit choice and the numbers move together.
 */
export function compare(rows: Row[]): { feature: string; groups: { label: string; videos: number; medianViews: number; medianEngagement: number }[] }[] {
  const linked = rows.filter((r) => r.features);
  if (linked.length < 2) return [];
  const numeric: [string, (f: Features) => number | null][] = [
    ["durationS", (f) => f.durationS], ["cutsPerMin", (f) => f.cutsPerMin], ["hookS", (f) => f.hookS], ["wordsPerMin", (f) => f.wordsPerMin],
  ];
  const out = [];
  const group = (label: string, rs: Row[]) => ({ label, videos: rs.length, medianViews: median(rs.map((r) => r.views)), medianEngagement: Math.round(median(rs.map((r) => r.engagement)) * 10000) / 10000 });
  for (const [name, get] of numeric) {
    const vals = linked.map((r) => get(r.features!)).filter((x): x is number => x !== null);
    if (vals.length < 2) continue;
    const m = median(vals);
    const lo = linked.filter((r) => { const x = get(r.features!); return x !== null && x <= m; });
    const hi = linked.filter((r) => { const x = get(r.features!); return x !== null && x > m; });
    if (lo.length && hi.length) out.push({ feature: name, groups: [group(`${name} <= ${m}`, lo), group(`${name} > ${m}`, hi)] });
  }
  for (const name of ["framework", "series"] as const) {
    const byValue = new Map<string, Row[]>();
    for (const r of linked) { const v = r.features![name] ?? "none"; byValue.set(v, [...(byValue.get(v) ?? []), r]); }
    if (byValue.size > 1) out.push({ feature: name, groups: [...byValue].map(([v, rs]) => group(v, rs)) });
  }
  return out;
}
