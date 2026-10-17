import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LibraryKind } from "./local";

export type OnlineItem = {
  source: "openverse" | "pexels" | "pixabay" | "freesound"; kind: LibraryKind; title: string;
  url: string; preview: string; page: string; license: string; creator: string; durationMs?: number;
};

/** API keys from the environment, or from ~/.adam-studio/.env (never from the repo). */
export function apiKey(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(join(homedir(), ".adam-studio", ".env"), "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
  } catch { return undefined; }
}

async function json(url: string, headers: Record<string, string> = {}, tries = 2): Promise<any> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "AdamStudio/0.1", ...headers }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
    return await r.json();
  } catch (e) {
    // Openverse is sometimes slow to answer a first query: one retry.
    if (tries > 1) return json(url, headers, tries - 1);
    throw e;
  }
}

/** Openverse: images and sounds (Freesound CC0 included), only licenses that allow a published edit: CC0, public domain, CC BY. */
async function openverse(q: string, kind: LibraryKind, n: number): Promise<OnlineItem[]> {
  if (kind !== "image" && kind !== "audio") return [];
  const type = kind === "image" ? "images" : "audio";
  const d = await json(`https://api.openverse.org/v1/${type}/?q=${encodeURIComponent(q)}&page_size=${n}&license=cc0,pdm,by`);
  return (d.results ?? []).map((r: any) => ({
    source: "openverse", kind, title: r.title ?? "", url: r.url, preview: r.thumbnail ?? r.url, page: r.foreign_landing_url ?? r.url,
    license: `${String(r.license).toUpperCase()} ${r.license_version ?? ""}`.trim(), creator: r.creator ?? "",
    ...(r.duration ? { durationMs: r.duration } : {}),
  }));
}

async function pexels(q: string, kind: LibraryKind, n: number): Promise<OnlineItem[]> {
  const key = apiKey("PEXELS_API_KEY");
  if (!key || (kind !== "image" && kind !== "video")) return [];
  if (kind === "image") {
    const d = await json(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n}`, { Authorization: key });
    return (d.photos ?? []).map((p: any) => ({ source: "pexels", kind, title: p.alt || `Pexels ${p.id}`, url: p.src.original, preview: p.src.medium, page: p.url, license: "Pexels License", creator: p.photographer }));
  }
  const d = await json(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${n}`, { Authorization: key });
  return (d.videos ?? []).map((v: any) => {
    const file = [...(v.video_files ?? [])].filter((f: any) => f.width).sort((a: any, b: any) => b.width - a.width).find((f: any) => f.width <= 1920) ?? v.video_files?.[0];
    return { source: "pexels", kind, title: `Pexels video ${v.id}`, url: file?.link, preview: v.image, page: v.url, license: "Pexels License", creator: v.user?.name ?? "", durationMs: v.duration * 1000 };
  });
}

async function pixabay(q: string, kind: LibraryKind, n: number): Promise<OnlineItem[]> {
  const key = apiKey("PIXABAY_API_KEY");
  if (!key || (kind !== "image" && kind !== "video")) return [];
  const per = Math.max(3, n);
  if (kind === "image") {
    const d = await json(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q)}&per_page=${per}&safesearch=true`);
    return (d.hits ?? []).map((h: any) => ({ source: "pixabay", kind, title: h.tags, url: h.largeImageURL, preview: h.webformatURL, page: h.pageURL, license: "Pixabay Content License", creator: h.user }));
  }
  const d = await json(`https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(q)}&per_page=${per}&safesearch=true`);
  return (d.hits ?? []).map((h: any) => ({
    source: "pixabay", kind, title: h.tags, url: (h.videos.large?.url || h.videos.medium?.url) as string, preview: h.videos.tiny?.thumbnail ?? "",
    page: h.pageURL, license: "Pixabay Content License", creator: h.user, durationMs: h.duration * 1000,
  }));
}

async function freesound(q: string, kind: LibraryKind, n: number): Promise<OnlineItem[]> {
  const key = apiKey("FREESOUND_API_KEY");
  if (!key || kind !== "audio") return [];
  const d = await json(`https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&page_size=${n}&filter=${encodeURIComponent('license:"Creative Commons 0"')}&fields=id,name,previews,license,username,url,duration&token=${key}`);
  return (d.results ?? []).map((s: any) => ({
    source: "freesound", kind, title: s.name, url: s.previews["preview-hq-mp3"], preview: s.previews["preview-lq-mp3"], page: s.url,
    license: "CC0 1.0", creator: s.username, durationMs: Math.round(s.duration * 1000),
  }));
}

/** Searches every connector that can answer for this kind; a failing or keyless source is reported, not thrown. */
export async function searchOnline(q: string, kind: LibraryKind, n = 8): Promise<{ items: OnlineItem[]; notes: string[] }> {
  const sources = { openverse, pexels, pixabay, freesound };
  const notes: string[] = [];
  const results = await Promise.all(Object.entries(sources).map(async ([name, fn]) => {
    try { return await fn(q, kind, n); } catch (e) { notes.push(`${name}: ${(e as Error).message}`); return []; }
  }));
  const missing = (["PEXELS_API_KEY", "PIXABAY_API_KEY", "FREESOUND_API_KEY"] as const).filter((k) => !apiKey(k));
  if (missing.length && kind !== "font" && kind !== "lottie") notes.push(`not searched (no key in ~/.adam-studio/.env): ${missing.join(", ")}`);
  return { items: results.flat().filter((i) => i.url), notes };
}
