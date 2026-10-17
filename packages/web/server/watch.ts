import { mkdirSync, watch, type FSWatcher } from "node:fs";

/** Calls onChange(project) (debounced) when a project's project.json, cache or renders change. */
export function watchProjects(root: string, onChange: (project: string) => void): () => void {
  try { mkdirSync(root, { recursive: true }); } catch { return () => {}; }
  const timers = new Map<string, NodeJS.Timeout>();
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const parts = filename.toString().split(/[\\/]/);
      const [project, top] = parts;
      if (!project || !top || !["project.json", "cache", "renders"].includes(top)) return;
      if (parts.includes(".bundle") || parts.some((p) => p.startsWith("tmp-"))) return;
      clearTimeout(timers.get(project));
      timers.set(project, setTimeout(() => { timers.delete(project); onChange(project); }, 300));
    });
  } catch { return () => {}; }
  return () => { watcher.close(); for (const t of timers.values()) clearTimeout(t); };
}
