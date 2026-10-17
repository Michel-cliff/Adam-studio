import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, relative } from "node:path";

export type LibraryKind = "video" | "image" | "audio" | "font" | "lottie";
export type LocalItem = {
  source: "inspiration"; path: string; rel: string; kind: LibraryKind; title: string; tags: string[]; notes: string;
  size: number; mtime: number; durationMs?: number; thumb?: string;
};

const EXT: Record<string, LibraryKind> = {
  ".mp4": "video", ".mov": "video", ".mkv": "video", ".webm": "video", ".m4v": "video",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image", ".svg": "image",
  ".wav": "audio", ".mp3": "audio", ".ogg": "audio", ".m4a": "audio", ".flac": "audio",
  ".ttf": "font", ".otf": "font",
  ".json": "lottie", ".lottie": "lottie",
};

export function inspirationRoot(): string {
  return process.env.ADAM_INSPIRATION ?? join(homedir(), "AdamStudioInspiration");
}

export function kindOf(file: string): LibraryKind | null {
  return EXT[extname(file).toLowerCase()] ?? null;
}

const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1);

function probeMs(file: string): number | undefined {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
    const s = Number.parseFloat(out);
    return Number.isFinite(s) ? Math.round(s * 1000) : undefined;
  } catch { return undefined; }
}

function isLottie(file: string): boolean {
  if (extname(file).toLowerCase() === ".lottie") return true;
  try { const j = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(j.layers) && typeof j.fr === "number"; } catch { return false; }
}

/**
 * Indexes the Inspiration folder: every video, image, sound, font and Lottie file, tagged with its folder names and
 * file name, with the text of a `<file>.txt` sidecar (or the folder's notes.txt) as notes. Videos get a duration and
 * a thumbnail. The index is cached in `.adam/index.json` and refreshed for files whose size or date changed.
 */
export function scanInspiration(root = inspirationRoot()): LocalItem[] {
  if (!existsSync(root)) return [];
  const cacheDir = join(root, ".adam");
  const cacheFile = join(cacheDir, "index.json");
  let cached = new Map<string, LocalItem>();
  try { cached = new Map((JSON.parse(readFileSync(cacheFile, "utf8")) as LocalItem[]).map((i) => [i.path, i])); } catch { /* first scan */ }
  const items: LocalItem[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) { walk(path); continue; }
      const kind = kindOf(e.name);
      if (!kind || (kind === "lottie" && !isLottie(path))) continue;
      const st = statSync(path);
      const old = cached.get(path);
      const sidecar = [`${path}.txt`, join(dir, "notes.txt")].find((f) => existsSync(f));
      const notes = sidecar ? readFileSync(sidecar, "utf8").trim().slice(0, 2000) : "";
      if (old && old.size === st.size && old.mtime === st.mtimeMs) { items.push({ ...old, notes }); continue; }
      const rel = relative(root, path);
      const item: LocalItem = {
        source: "inspiration", path, rel, kind, title: basename(e.name, extname(e.name)),
        tags: [...new Set(words(rel))], notes, size: st.size, mtime: st.mtimeMs,
      };
      if (kind === "video" || kind === "audio") item.durationMs = probeMs(path);
      if (kind === "video") {
        mkdirSync(join(cacheDir, "thumbs"), { recursive: true });
        const thumb = join(cacheDir, "thumbs", `${Buffer.from(rel).toString("base64url").slice(0, 80)}.jpg`);
        try {
          const at = item.durationMs ? (item.durationMs / 3000).toFixed(2) : "0";
          execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", at, "-i", path, "-frames:v", "1", "-vf", "scale=-2:320", thumb]);
          item.thumb = thumb;
        } catch { /* unreadable video */ }
      }
      items.push(item);
    }
  };
  walk(root);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(items));
  return items;
}

/** Inspiration items matching every word of the query (in title, folders or notes), best matches first. */
export function searchLocal(query: string, kind?: LibraryKind, root = inspirationRoot()): LocalItem[] {
  const q = words(query);
  return scanInspiration(root)
    .filter((i) => !kind || i.kind === kind)
    .map((i) => {
      const hay = new Set([...i.tags, ...words(i.notes)]);
      const hits = q.filter((w) => hay.has(w) || [...hay].some((h) => h.startsWith(w)));
      return { i, score: q.length ? hits.length / q.length : 1 };
    })
    .filter((x) => x.score === 1)
    .sort((a, b) => b.i.mtime - a.i.mtime)
    .map((x) => x.i);
}
