import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** A JPEG of the first take, one second in, made once from the cache (renders/.thumb.jpg). */
export function thumbnail(dir: string): string | null {
  const out = join(dir, "renders", ".thumb.jpg");
  if (existsSync(out)) return out;
  const cache = join(dir, "cache");
  if (!existsSync(cache)) return null;
  for (const asset of readdirSync(cache).sort()) {
    for (const f of ["proxy.mp4", "edit.mp4"]) {
      const src = join(cache, asset, f);
      if (!existsSync(src) || statSync(src).size === 0) continue;
      try {
        mkdirSync(dirname(out), { recursive: true });
        execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "scale=360:-2", out]);
        return out;
      } catch { /* try the next file */ }
    }
  }
  return null;
}
