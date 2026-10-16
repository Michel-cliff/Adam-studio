import type { Clip, Project } from "./schema/project";
import type { WordRef } from "./words";

export interface ClipLayout {
  clip: Clip;
  index: number;
  outStartMs: number;
  outEndMs: number;
}

export interface StoryLayout {
  clips: ClipLayout[];
  totalMs: number;
}

/** Clips laid end to end (the story is magnetic: no gaps, no overlaps). */
export function layoutStory(project: Pick<Project, "story">): StoryLayout {
  let acc = 0;
  const clips = project.story.map((clip, index) => {
    const outStartMs = acc;
    acc += clip.outMs - clip.inMs;
    return { clip, index, outStartMs, outEndMs: acc };
  });
  return { clips, totalMs: acc };
}

/** Output time of a source moment, or null when it was cut. A range used twice maps to its first use. */
export function sourceToOutputMs(clips: ClipLayout[], asset: string, ms: number): number | null {
  for (const l of clips) {
    if (l.clip.asset === asset && ms >= l.clip.inMs && ms < l.clip.outMs) return l.outStartMs + (ms - l.clip.inMs);
  }
  return null;
}

/** Output span of a word, decided by where the word starts; its end is clipped at that clip's out point. */
export function wordOutput(clips: ClipLayout[], word: WordRef): { startMs: number; endMs: number } | null {
  for (const l of clips) {
    const c = l.clip;
    if (c.asset === word.asset && word.startMs >= c.inMs && word.startMs < c.outMs) {
      return {
        startMs: l.outStartMs + (word.startMs - c.inMs),
        endMs: l.outStartMs + (Math.min(word.endMs, c.outMs) - c.inMs),
      };
    }
  }
  return null;
}
