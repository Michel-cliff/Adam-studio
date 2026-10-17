import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = join(WEB, "..", "..");
export const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
export const CLI = join(REPO, "packages", "render", "src", "cli.ts");

/** The python of a py/<pkg> venv, or the path in envVar, or null when neither exists. */
export function venvPython(pkg: "analysis" | "capcut", envVar: string): string | null {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  for (const p of [join(REPO, "py", pkg, ".venv", "Scripts", "python.exe"), join(REPO, "py", pkg, ".venv", "bin", "python")]) if (existsSync(p)) return p;
  return null;
}
