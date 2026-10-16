/** Two balanced lines when the text is longer than maxChars and has no manual break. */
export function wrapCaption(text: string, maxChars: number): string {
  if (text.length <= maxChars || text.includes("\n")) return text;
  const words = text.split(" ");
  if (words.length < 2) return text;
  let best = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Character ranges of each phrase, case-insensitive, tolerant to a line break between its words. */
export function findHighlights(text: string, phrases: string[]): { ranges: [number, number][]; missing: string[] } {
  const ranges: [number, number][] = [];
  const missing: string[] = [];
  for (const phrase of phrases) {
    const pattern = phrase.trim().split(/\s+/).map(escapeRegExp).join("[ \\n]+");
    const m = new RegExp(pattern, "i").exec(text);
    if (m) ranges.push([m.index, m.index + m[0].length]);
    else missing.push(phrase);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { ranges, missing };
}

export function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[.,!?;:…"«»()]/g, "").trim();
}
