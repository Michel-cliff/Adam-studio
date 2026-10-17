import { newWorkflow, parseProject, type Project, type Style, type Word } from "@adam-studio/model";
import { cutWords, tightenPauses } from "./cuts";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}' ]/gu, "").trim();

/** Words heard in the edit, in story order (a word counts when it lies inside a story clip). */
export function keptWords(p: Project): Word[] {
  return p.story.flatMap((c) => (p.transcript.words[c.asset] ?? []).filter((w) => w.startMs >= c.inMs && w.endMs <= c.outMs).sort((a, b) => a.startMs - b.startMs));
}

/** Filler words (one or two words long) of the transcript's language, or the format's own list. */
export function findFillers(words: Word[], fillers: string[]): string[] {
  const one = new Set(fillers.filter((f) => !f.includes(" ")).map(norm));
  const two = new Set(fillers.filter((f) => f.includes(" ")).map(norm));
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const a = norm(words[i]!.text);
    const b = words[i + 1] ? norm(words[i + 1]!.text) : "";
    if (b && two.has(`${a} ${b}`)) { out.push(words[i]!.id, words[i + 1]!.id); i++; }
    else if (one.has(a)) out.push(words[i]!.id);
  }
  return out;
}

/**
 * Retakes: the speaker starts a sentence, stops, and starts it again (in the same take or the next one). When the
 * same three words (10 letters or more, so "je me suis" does not count) come back after a pause or a take change, within
 * 10 seconds of the edit,
 * everything from the first attempt up to the restart is a failed take, at most 40 words; the last attempt is kept.
 * `at` gives a word's time in the edit: takes each have their own clock.
 */
export function findRetakes(words: Word[], at: (w: Word) => number = (w) => w.startMs, windowMs = 10000): { from: string; to: string; ids: string[] }[] {
  const out: { from: string; to: string; ids: string[] }[] = [];
  const key = (i: number) => (i + 2 < words.length ? [0, 1, 2].map((k) => norm(words[i + k]!.text)).join(" ") : "");
  let i = 0;
  while (i < words.length) {
    const k = key(i);
    let restart = -1;
    if (k && k.replace(/ /g, "").length >= 10) {
      for (let j = i + 3; j < words.length && j - i <= 40 && at(words[j]!) - at(words[i]!) <= windowMs; j++) {
        // A restart follows a break (a pause, or another take): repeating oneself in one breath is rhetoric.
        const prev = words[j - 1]!;
        const takeOf = (w: Word) => w.id.slice(0, w.id.lastIndexOf(".w"));
        const pauseBefore = takeOf(prev) !== takeOf(words[j]!) || words[j]!.startMs - prev.endMs >= 350;
        if (key(j) === k && pauseBefore) restart = j;
      }
    }
    if (restart > 0) {
      const ids = words.slice(i, restart).map((w) => w.id);
      out.push({ from: words[i]!.id, to: words[restart - 1]!.id, ids });
      i = restart;
    } else i++;
  }
  return out;
}

/** Each kept word's time in the edit (story clips back to back). */
export function editTimes(p: Project): Map<string, number> {
  const out = new Map<string, number>();
  let offset = 0;
  for (const c of p.story) {
    for (const w of p.transcript.words[c.asset] ?? []) if (w.startMs >= c.inMs && w.endMs <= c.outMs) out.set(w.id, offset + w.startMs - c.inMs);
    offset += c.outMs - c.inMs;
  }
  return out;
}

/** Captions: chunks of the edit's words, broken at punctuation, pauses and the line length. */
export function captionChunks(words: Word[], maxChars: number, highlight: boolean) {
  const chunks: { words: [string, string]; text: string; highlight: string[] }[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.text.trim()).join(" ");
    const longest = [...cur].map((w) => w.text.replace(/[^\p{L}\p{N}'-]/gu, "")).sort((a, b) => b.length - a.length)[0] ?? "";
    chunks.push({ words: [cur[0]!.id, cur[cur.length - 1]!.id], text, highlight: highlight && longest.length >= 6 ? [longest] : [] });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    const length = [...cur, w].map((x) => x.text.trim()).join(" ").length;
    if (cur.length && length > maxChars) flush();
    cur.push(w);
    const pause = next ? next.startMs - w.endMs : Infinity;
    // A caption stays inside one take and one stretch of it: break at a take change or a jump back in time.
    const otherTake = next !== undefined && next.id.slice(0, next.id.lastIndexOf(".w")) !== w.id.slice(0, w.id.lastIndexOf(".w"));
    if (/[.!?…,;:]$/.test(w.text.trim()) || pause > 300 || pause < 0 || otherTake) flush();
  }
  flush();
  return chunks;
}

export type FirstPassSummary = { fillers: number; retakes: { from: string; to: string; words: number }[]; captions: number; proposals: string[]; skipped: string[] };

/**
 * The mechanical part of a first pass, as proposals of the guided workflow (nothing is applied until decided):
 * cuts (A tight: fillers, retakes and long pauses; B light: fillers and very long pauses) and captions (A two lines
 * with a highlighted word, B one line). Re-running replaces its own pending proposals and leaves decided ones alone.
 */
export function firstPass(input: Project, style: Style): { project: Project; summary: FirstPassSummary } {
  let p: Project = { ...input, workflow: input.workflow ?? newWorkflow() };
  const words = keptWords(p);
  const fillerList = style.lint[p.canvas.format]?.fillers ?? style.fillers?.[p.transcript.lang] ?? [];
  const fillers = findFillers(words, fillerList);
  const times = editTimes(p);
  const retakes = findRetakes(words, (w) => times.get(w.id) ?? w.startMs);
  const summary: FirstPassSummary = { fillers: fillers.length, retakes: retakes.map((r) => ({ from: r.from, to: r.to, words: r.ids.length })), captions: 0, proposals: [], skipped: [] };

  const put = (id: string, step: Project["proposals"][number]["step"], reason: string, variants: { key: "A" | "B"; label: string; patch: Record<string, unknown> }[]) => {
    const old = p.proposals.find((x) => x.id === id);
    if (old && (old.status !== "pending" || old.history.length)) { summary.skipped.push(`${id} (already decided or discussed)`); return; }
    const proposal = { id, step, reason, variants, status: "pending" as const, history: [] };
    p = { ...p, proposals: old ? p.proposals.map((x) => (x.id === id ? (proposal as never) : x)) : [...p.proposals, proposal as never] };
    summary.proposals.push(id);
  };

  const safeCut = (ids: string[]) => { try { return ids.length ? cutWords(p, ids) : p; } catch { return p; } };
  const tight = tightenPauses(safeCut([...new Set([...fillers, ...retakes.flatMap((r) => r.ids)])]), 400, 200);
  const light = tightenPauses(safeCut(fillers), 900, 300);
  const same = (a: Project) => JSON.stringify(a.story) === JSON.stringify(p.story);
  const cutVariants: { key: "A" | "B"; label: string; patch: Record<string, unknown> }[] = [];
  if (!same(tight)) cutVariants.push({ key: "A", label: `tight: ${fillers.length} fillers, ${retakes.length} retakes, pauses over 0.4 s`, patch: { setStory: tight.story } });
  if (!same(light) && JSON.stringify(light.story) !== JSON.stringify(tight.story)) {
    cutVariants.push({ key: cutVariants.length ? "B" : "A", label: `light: ${fillers.length} fillers, pauses over 0.9 s`, patch: { setStory: light.story } });
  }
  if (cutVariants.length) put("auto.cuts", "cuts", "First pass: fillers, failed takes and dead air", cutVariants);
  else summary.skipped.push("auto.cuts (nothing to cut)");

  if (p.captions.length === 0 && words.length) {
    const max = style.caption.maxCharsPerLine;
    const two = captionChunks(words, max * 2, true);
    const one = captionChunks(words, max, false);
    summary.captions = two.length;
    put("auto.captions", "captions", "First pass: captions from the transcript", [
      { key: "A", label: `${two.length} captions, two lines, one word highlighted`, patch: { addCaptions: two } },
      { key: "B", label: `${one.length} captions, one line, no highlight`, patch: { addCaptions: one } },
    ]);
  } else summary.skipped.push(p.captions.length ? "auto.captions (the project has captions)" : "auto.captions (no words)");

  const parsed = parseProject(JSON.parse(JSON.stringify(p)));
  if (!parsed.ok) throw new Error(`first pass produced an invalid project: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  return { project: parsed.value, summary };
}
