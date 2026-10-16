import type { Style } from "@adam-studio/model";

export type Span = { text: string; highlight: boolean };

/** Lines of spans from the wrapped caption text; ranges are character offsets into the whole text. */
export function captionLines(text: string, ranges: [number, number][]): Span[][] {
  const isHighlight = (i: number) => ranges.some(([a, b]) => i >= a && i < b);
  const lines: Span[][] = [];
  let line: Span[] = [];
  let cur: Span | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      if (cur) line.push(cur);
      lines.push(line);
      line = [];
      cur = null;
      continue;
    }
    const h = isHighlight(i);
    if (cur && cur.highlight === h) cur.text += ch;
    else {
      if (cur) line.push(cur);
      cur = { text: ch, highlight: h };
    }
  }
  if (cur) line.push(cur);
  lines.push(line);
  return lines;
}

/** Font size so the longest line fits maxWidth, from an average glyph width in em, capped at maxSize. */
export function fitFontSize(text: string, maxWidth: number, maxSize: number, glyphEm = 0.6): number {
  const longest = Math.max(1, ...text.split("\n").map((l) => l.length));
  return Math.min(maxSize, Math.floor(maxWidth / (longest * glyphEm)));
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function easeOutCubic(p: number): number {
  return 1 - (1 - clamp01(p)) ** 3;
}

/** Reveal progress (0 to 1) of line `index`, lines staggered after an initial delay. */
export function lineReveal(localMs: number, index: number, staggerMs = 160, durationMs = 240, delayMs = 80): number {
  return easeOutCubic((localMs - delayMs - index * staggerMs) / durationMs);
}

/** Glitch burst: 100 ms decaying from each line's start, and rising over the last 160 ms of the phase. */
export function glitchAmount(localMs: number, phaseMs: number, lineCount: number, staggerMs = 160, delayMs = 80): number {
  let g = 0;
  for (let i = 0; i < lineCount; i++) {
    const d = localMs - delayMs - i * staggerMs;
    if (d >= 0 && d < 100) g = Math.max(g, 1 - d / 100);
  }
  const left = phaseMs - localMs;
  if (left < 160) g = Math.max(g, 1 - Math.max(0, left) / 160);
  return g;
}

export function exitOpacity(localMs: number, phaseMs: number, fadeMs = 160): number {
  const left = phaseMs - localMs;
  return left >= fadeMs ? 1 : Math.max(0, left / fadeMs);
}

/** A style color by name ("accent", "ink", "text", "highlight"), or the value itself (a hex color). */
export function colorOf(name: string, style: Pick<Style, "colors">): string {
  const colors = style.colors as Record<string, string>;
  return colors[name] ?? name;
}
