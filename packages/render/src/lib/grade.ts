import type { Style } from "@adam-studio/model";

type Grade = Style["grade"];

export const GRADE_FILTER_ID = "adam-grade";

const round = (n: number) => Math.round(n * 1000) / 1000;

/** feColorMatrix values: warm boosts red, slightly green, and cuts blue. */
export function warmthMatrix(warmth: number): number[] {
  const r = 1 + 0.12 * warmth;
  const g = 1 + 0.02 * warmth;
  const b = 1 - 0.14 * warmth;
  return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
}

/** CSS filter for the grade; warmth goes through the SVG filter `svgId`. */
export function gradeFilter(grade: Grade, svgId: string): string {
  const parts: string[] = [];
  if (grade.warmth !== 0) parts.push(`url(#${svgId})`);
  if (grade.contrast !== 0) parts.push(`contrast(${round(1 + grade.contrast)})`);
  if (grade.saturation !== 0) parts.push(`saturate(${round(1 + grade.saturation)})`);
  if (grade.brightness !== 0) parts.push(`brightness(${round(1 + grade.brightness)})`);
  return parts.length ? parts.join(" ") : "none";
}

/** Only the warmth part of the grade: CapCut applies brightness, contrast and saturation over baked stretches itself. */
export function warmthFilter(grade: Grade, svgId: string): string {
  return grade.warmth !== 0 ? `url(#${svgId})` : "none";
}

export function vignetteBackground(amount: number): string {
  if (amount <= 0) return "none";
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${round(0.65 * amount)}) 100%)`;
}
