import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export const SETTINGS_FILE = join(homedir(), ".adam-studio", "ui.json");

export function projectsRoot(file = SETTINGS_FILE): string {
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    if (typeof s.projectsRoot === "string" && s.projectsRoot) return s.projectsRoot;
  } catch { /* no saved setting */ }
  return process.env.ADAM_PROJECTS ?? join(homedir(), "AdamStudioProjects");
}

export function setProjectsRoot(root: string, file = SETTINGS_FILE): void {
  if (!isAbsolute(root)) throw new Error(`the projects folder must be an absolute path, got "${root}"`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ projectsRoot: root }, null, 2)}\n`);
}
