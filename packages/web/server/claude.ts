import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "./actions";
import { ActionError } from "./actions";
import { REPO, TSX } from "./paths";

/** Claude Code's executable: ADAM_CLAUDE, the npm install's claude.exe on Windows, or `claude` on the PATH. */
export function claudeBin(): string {
  if (process.env.ADAM_CLAUDE) return process.env.ADAM_CLAUDE;
  const npmExe = process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe") : "";
  return npmExe && existsSync(npmExe) ? npmExe : "claude";
}

export const STEP_BRIEFS: Record<string, string> = {
  cuts: "Cuts: what stays. Remove dead air, fillers, failed takes, tangents; keep the strongest version of each idea.",
  structure: "Story: the order and the narrative framework (setStructure with beats on word ids, setStory to reorder).",
  captions: "Captions: words on screen (addCaptions; caption font and colors go through setStyle).",
  hook: "Hook: the first 3 seconds. A title at 0 ms, a tighter or reordered opening, a bold first frame.",
  beats: "Beats: what marks each change of idea (text.behindSubject with the key word, camera.zoom punch-ins, transitions).",
  visuals: "Visuals: images, HUD panels and stats, Lottie where the speech names something showable (Inspiration folder first).",
  sound: "Sound: sound effects on reveals and key cuts (search_assets kind audio, import_asset).",
  look: "Look: fonts (setStyle fonts.title / fonts.caption with family and file), colors, grade, animation speed (motion.speed).",
};

/**
 * Asks Claude Code (headless, the creator's subscription) to write one proposal for a step, through the
 * adam-studio MCP tools only. Its stream-json output is the job's log; the panel turns it into an activity feed.
 */
export function askCommand(project: string, step: string, prompt: string): Command {
  if (!STEP_BRIEFS[step]) throw new ActionError(`unknown step "${step}"`);
  if (!prompt.trim()) throw new ActionError("write what you want first");
  const id = `ask.${step}.${Date.now().toString(36)}`;
  const system = [
    "You are the editor inside Adam Studio, working for the creator through the adam-studio tools only.",
    `Project: "${project}" (pass it as the project argument). Current step: ${step}. ${STEP_BRIEFS[step]}`,
    `Write exactly ONE proposal with the propose tool: id "${id}", step "${step}", two or three variants (A, B, C) that are genuinely different,`,
    "labels of at most 60 characters that say what the creator will see, and a one-sentence reason. Anchor on word ids (get_transcript).",
    "Check get_project first; use get_reference for schemas, search_assets / look_at / import_asset for media, still to look at a variant.",
    "The creator's taste: animations a bit slower than default, few meaningful effects. Never call decide or run.",
    "End with ONE short plain sentence (under 30 words) for the creator, in the language of the transcript: no markdown, no ids, no list.",
  ].join("\n");
  const mcp = JSON.stringify({ mcpServers: { "adam-studio": { command: process.execPath, args: [TSX, join(REPO, "packages", "mcp", "src", "server.ts")] } } });
  return {
    cmd: claudeBin(),
    args: ["-p", prompt, "--append-system-prompt", system, "--output-format", "stream-json", "--verbose",
      "--strict-mcp-config", "--mcp-config", mcp, "--allowedTools", "mcp__adam-studio"],
    label: `Claude: ${step}`,
  };
}
