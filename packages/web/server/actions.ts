import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CLI, TSX } from "./paths";

export class ActionError extends Error {}
export type Command = { cmd: string; args: string[]; label: string };
type Opts = Record<string, unknown>;

export const VIDEO_EXT = /\.(mp4|mov|mkv|m4v|avi|webm)$/i;
const ID_LIST = /^[A-Za-z0-9][A-Za-z0-9_-]*(,[A-Za-z0-9][A-Za-z0-9_-]*)*$/;
const STEP_LIST = /^(edit|proxy|transcript|silences|subject|plate)(,(edit|proxy|transcript|silences|subject|plate))*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const LANG = /^[a-z]{2,3}$/;

function text(o: Opts, key: string, pattern?: RegExp): string | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ActionError(`${key} must be text`);
  if (pattern && !pattern.test(v)) throw new ActionError(`${key} is not valid: "${v}"`);
  return v;
}

function flag(o: Opts, key: string): string[] {
  const v = o[key];
  if (v === undefined || v === false) return [];
  if (v !== true) throw new ActionError(`${key} must be true or false`);
  return [`--${key}`];
}

export function cliCommand(args: string[], label: string): Command {
  return { cmd: process.execPath, args: [TSX, CLI, ...args], label };
}

export function buildCommand(action: string, dir: string, o: Opts, capcutPython: string | null): Command {
  switch (action) {
    case "analyze": {
      const assets = text(o, "assets", ID_LIST);
      const steps = text(o, "steps", STEP_LIST);
      return cliCommand(["analyze", dir, ...(assets ? ["--assets", assets] : []), ...(steps ? ["--steps", steps] : []), ...flag(o, "force")], "Analyze");
    }
    case "render":
      return cliCommand(["render", dir, ...flag(o, "force")], "Render");
    case "review": {
      const step = text(o, "step", ID);
      return cliCommand(["review", dir, ...(step ? ["--step", step] : [])], "Review");
    }
    case "decide": {
      const proposal = text(o, "proposal", ID);
      const decision = text(o, "decision", /^(A|B|C|reject|more)$/);
      if (!proposal || !decision) throw new ActionError("decide needs a proposal and a decision (A, B, C, reject or more)");
      const note = text(o, "note");
      return cliCommand(["decide", dir, proposal, decision, ...(note ? [`--note=${note}`] : [])], `Decide ${proposal}: ${decision}`);
    }
    case "capcut": {
      if (!capcutPython) {
        throw new ActionError('The CapCut environment is missing. Create it (README, Export to CapCut):\n  python -m venv py/capcut/.venv\n  py/capcut/.venv/Scripts/python -m pip install -e "py/capcut[dev]"');
      }
      const name = text(o, "name");
      return { cmd: capcutPython, args: ["-m", "adam_capcut", "export", dir, ...(name ? [`--name=${name}`] : []), ...flag(o, "force"), ...flag(o, "replace")], label: "Export to CapCut" };
    }
    case "studio":
      return cliCommand(["studio", dir], "Studio");
    default:
      throw new ActionError(`unknown action "${action}"`);
  }
}

export function checkVideos(videos: unknown): string[] {
  if (!Array.isArray(videos) || videos.some((v) => typeof v !== "string")) throw new ActionError("videos must be a list of file paths");
  if (videos.length === 0) throw new ActionError("pick at least one video");
  for (const v of videos as string[]) {
    if (!isAbsolute(v)) throw new ActionError(`not an absolute path: ${v}`);
    if (!existsSync(v) || !statSync(v).isFile()) throw new ActionError(`video not found: ${v}`);
    if (!VIDEO_EXT.test(v)) throw new ActionError(`not a video file: ${v}`);
  }
  return videos as string[];
}

export function newProjectCommand(dir: string, videos: string[], format: string, lang?: string, series?: string): Command {
  if (format !== "9:16" && format !== "16:9") throw new ActionError(`format must be 9:16 or 16:9, got "${format}"`);
  if (lang !== undefined && !LANG.test(lang)) throw new ActionError(`language is not valid: "${lang}"`);
  if (series !== undefined && /[\/:*?"<>|]/.test(series)) throw new ActionError(`not a valid series name: "${series}"`);
  return cliCommand(["new", dir, ...videos, "--format", format, ...(lang ? ["--lang", lang] : []), ...(series ? [`--series=${series}`] : [])], "New project");
}

export function addCommand(dir: string, videos: string[], lang?: string): Command {
  if (lang !== undefined && !LANG.test(lang)) throw new ActionError(`language is not valid: "${lang}"`);
  return cliCommand(["add", dir, ...videos, ...(lang ? ["--lang", lang] : [])], "Add rushes");
}
