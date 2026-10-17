import { src } from "./lib/src";
import { loadFont } from "@remotion/fonts";
import { CAPTION_FONT, TITLE_FONT, type RenderProps } from "./props";

const requested = new Set<string>();

/** Loads the style fonts once; loadFont blocks the render until they are ready. */
export function ensureFonts(fonts: RenderProps["fonts"]): void {
  for (const [family, path] of [[CAPTION_FONT, fonts.caption], [TITLE_FONT, fonts.title]] as const) {
    const key = `${family}:${path}`;
    if (!path || requested.has(key)) continue;
    requested.add(key);
    void loadFont({ family, url: src(path) });
  }
}
