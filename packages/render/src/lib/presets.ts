import { clamp01, easeOutCubic } from "./text";

export type PresetStyle = { opacity?: number; transform?: string; filter?: string };

/** Style of an entrance (or exit, with msFromEdge counted from the end) preset at msFromEdge. */
export function presetStyle(name: string | undefined, msFromEdge: number, frame: number): PresetStyle {
  switch (name) {
    case "fade":
      return { opacity: clamp01(msFromEdge / 250) };
    case "pop":
      return { opacity: clamp01(msFromEdge / 120), transform: `scale(${0.9 + 0.1 * easeOutCubic(msFromEdge / 200)})` };
    case "glitch": {
      if (msFromEdge >= 200) return {};
      const g = 1 - msFromEdge / 200;
      const shift = Math.round(6 * g);
      const jitter = ((frame * 37) % 11) - 5;
      return {
        opacity: frame % 2 === 0 && g > 0.5 ? 0.6 : 1,
        transform: `translateX(${Math.round(jitter * g)}px)`,
        filter: `drop-shadow(${-shift}px 0 rgba(255,0,60,0.8)) drop-shadow(${shift}px 0 rgba(0,220,255,0.8))`,
      };
    }
    default:
      return {};
  }
}
