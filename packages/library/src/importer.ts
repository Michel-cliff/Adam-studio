import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { kindOf, type LibraryKind } from "./local";

export type ImportSource = { path?: string; url?: string; kind?: LibraryKind; title?: string; license?: string; creator?: string; page?: string };
export type Imported = { id: string; kind: LibraryKind; path: string; file: string };

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "asset";

/**
 * Copies a local file, or downloads a URL, into `<project>/assets/` and records where it came from (license,
 * author, page) in `assets/CREDITS.md`. Returns the asset to add to the project (path relative to the project).
 */
export async function importAsset(projectDir: string, src: ImportSource, id?: string): Promise<Imported> {
  if (!src.path && !src.url) throw new Error("give a path or a url");
  const name = src.path ? basename(src.path) : basename(new URL(src.url!).pathname) || "download";
  const kind = src.kind ?? kindOf(name);
  if (!kind) throw new Error(`cannot tell what ${name} is: give kind (video, image, audio, font, lottie)`);
  const folder = join(projectDir, "assets");
  mkdirSync(folder, { recursive: true });
  const assetId = id ?? slug(src.title ?? basename(name, extname(name)));
  const ext = extname(name) || ({ video: ".mp4", image: ".jpg", audio: ".mp3", font: ".ttf", lottie: ".json" } as const)[kind];
  const file = join(folder, `${assetId}${ext}`);
  if (existsSync(file)) throw new Error(`${file} exists: pick another id`);
  if (src.path) {
    if (!existsSync(src.path)) throw new Error(`not found: ${src.path}`);
    copyFileSync(src.path, file);
  } else {
    const r = await fetch(src.url!, { headers: { "User-Agent": "AdamStudio/0.1" }, signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`download failed: ${r.status} ${src.url}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  if (src.url || src.license) {
    const credits = join(folder, "CREDITS.md");
    if (!existsSync(credits)) writeFileSync(credits, "# Credits\n\n");
    appendFileSync(credits, `- ${basename(file)}: "${src.title ?? name}" by ${src.creator || "unknown"}, ${src.license ?? "license unknown"}${src.page ? `, ${src.page}` : ""}\n`);
  }
  return { id: assetId, kind, path: `assets/${basename(file)}`, file };
}

/**
 * A picture of a file for Claude to look at, as base64 JPEG: four frames of a video, the image itself, the waveform
 * of a sound, or a sample line of a font. Local paths and URLs both work.
 */
export async function lookAt(pathOrUrl: string): Promise<{ kind: LibraryKind; jpeg: string; note: string }> {
  let file = pathOrUrl;
  let temp: string | null = null;
  if (/^https?:\/\//.test(pathOrUrl)) {
    const r = await fetch(pathOrUrl, { headers: { "User-Agent": "AdamStudio/0.1" }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`download failed: ${r.status}`);
    temp = join(tmpdir(), `adam-look-${process.pid}-${Date.now()}${extname(new URL(pathOrUrl).pathname) || ".bin"}`);
    writeFileSync(temp, Buffer.from(await r.arrayBuffer()));
    file = temp;
  }
  const kind = kindOf(file) ?? "image";
  const out = join(tmpdir(), `adam-look-${process.pid}-${Date.now()}.jpg`);
  const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args, "-frames:v", "1", "-q:v", "4", out]);
  let note = "";
  try {
    if (kind === "video") {
      const d = Number.parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" })) || 1;
      ff(["-i", file, "-vf", `fps=${(4 / d).toFixed(4)},scale=-2:480,tile=4x1`]);
      note = `four frames across ${d.toFixed(1)} s`;
    } else if (kind === "audio") {
      ff(["-i", file, "-filter_complex", "showwavespic=s=1200x240:colors=white", "-update", "1"]);
      note = "waveform";
    } else if (kind === "font") {
      const font = file.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
      ff(["-f", "lavfi", "-i", "color=c=0x16161a:s=1400x260", "-vf", `drawtext=fontfile='${font}':text='Adam Studio 0123 AaBbCc':fontcolor=white:fontsize=96:x=40:y=80`]);
      note = "font sample";
    } else if (kind === "lottie") {
      note = `Lottie JSON (${readFileSync(file, "utf8").length} bytes): no picture`;
      return { kind, jpeg: "", note };
    } else {
      ff(["-i", file, "-vf", "scale='min(1280,iw)':-2"]);
      note = "image";
    }
    return { kind, jpeg: readFileSync(out).toString("base64"), note };
  } finally {
    rmSync(out, { force: true });
    if (temp) rmSync(temp, { force: true });
  }
}
