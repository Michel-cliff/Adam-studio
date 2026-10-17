import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { VIDEO_EXT } from "./actions";
import type { FolderView } from "./types";

/** Folders and video files of path; without a path, the drives (Windows) or "/". */
export function listFolder(path?: string): FolderView {
  if (!path) {
    if (process.platform !== "win32") return listFolder("/");
    const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((d) => existsSync(d));
    return { path: null, parent: null, folders: drives, videos: [] };
  }
  const entries = readdirSync(path, { withFileTypes: true }).filter((e) => !e.name.startsWith(".") && !e.name.startsWith("$"));
  const sorted = (xs: string[]) => xs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((n) => join(path, n));
  const up = dirname(path);
  return {
    path,
    parent: up === path ? (process.platform === "win32" ? "" : null) : up,
    folders: sorted(entries.filter((e) => e.isDirectory()).map((e) => e.name)),
    videos: sorted(entries.filter((e) => e.isFile() && VIDEO_EXT.test(e.name)).map((e) => e.name)),
  };
}
