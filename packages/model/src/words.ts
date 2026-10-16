import type { Project } from "./schema/project";

export interface WordRef {
  id: string;
  asset: string;
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

export function indexWords(project: Pick<Project, "transcript">): Map<string, WordRef> {
  const map = new Map<string, WordRef>();
  for (const [asset, list] of Object.entries(project.transcript.words)) {
    list.forEach((w, index) => {
      map.set(w.id, { id: w.id, asset, index, text: w.text, startMs: w.startMs, endMs: w.endMs });
    });
  }
  return map;
}
