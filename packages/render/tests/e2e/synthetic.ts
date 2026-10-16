import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectInput, styleInput } from "../unit/helpers";

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
];

export function findSystemFont(): string {
  const f = FONT_CANDIDATES.find((p) => existsSync(p));
  if (!f) throw new Error(`no system font found among ${FONT_CANDIDATES.join(", ")}`);
  return f;
}

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
}

/**
 * A 4 s 1080x1920 project: left half red, right half blue, 440 Hz tone; a transparent green 400x400 square as
 * the subject matte; a gray plate; a magenta full-frame image; a beep.
 */
export function makeSynthetic(dir: string, opts: { withProposal?: boolean } = {}): void {
  const cache = join(dir, "cache", "s");
  const src = join(dir, "assets-src");
  mkdirSync(cache, { recursive: true });
  mkdirSync(src, { recursive: true });
  // Cache contract: edit.mp4 has a keyframe every second and no B-frames. With long GOPs, Remotion's
  // frame cache loses frames during parallel renders ("No frame found at position").
  ffmpeg([
    "-f", "lavfi", "-i", "color=c=red:s=540x1920:r=30:d=4",
    "-f", "lavfi", "-i", "color=c=blue:s=540x1920:r=30:d=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]", "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(cache, "edit.mp4"),
  ]);
  ffmpeg([
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=4",
    "-vf", "format=rgba,geq=r='0':g='255':b='0':a='if(between(X,340,740)*between(Y,760,1160),255,0)'",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "1M", join(cache, "subject.webm"),
  ]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=1080x1920", "-frames:v", "1", join(cache, "plate.png")]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=magenta:s=1080x1920", "-frames:v", "1", join(src, "magenta.png")]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=880:duration=0.3", join(src, "beep.wav")]);

  const font = findSystemFont();
  const style = { ...styleInput, fonts: { caption: { family: "Caption", file: font }, title: { family: "Title", file: font } } };
  writeFileSync(join(dir, "style.json"), `${JSON.stringify(style, null, 2)}\n`);
  const proposals = opts.withProposal
    ? [{
        id: "p1", step: "visuals", anchor: { word: "s.w2" }, reason: "test proposal",
        variants: [
          { key: "A", label: "magenta in front, élan: oui", patch: { addElements: [{ id: "pA", kind: "image", anchor: { word: "s.w2" }, durationMs: 500, props: { asset: "m" } }] } },
          { key: "B", label: "nothing", patch: {} },
        ],
      }]
    : [];
  writeFileSync(join(dir, "project.json"), `${JSON.stringify({ ...projectInput(), proposals }, null, 2)}\n`);
}
