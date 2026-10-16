export type Format = "9:16" | "16:9";

export const FORMAT_SIZES: Record<Format, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

export function canvasSize(format: Format): { width: number; height: number } {
  return FORMAT_SIZES[format];
}

/** Milliseconds to the nearest frame. Convert accumulated positions, never add rounded durations. */
export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}
