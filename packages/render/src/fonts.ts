import { src } from "./lib/src";
import { loadFont } from "@remotion/fonts";
import { CAPTION_FONT, TITLE_FONT, type RenderProps } from "./props";

const requested = new Set<string>();

/** The CSS font format, explicit so collections (.ttc) and files without an extension load after bundling. */
export function fontFormat(path: string): "truetype" | "opentype" | "collection" | "woff" | "woff2" {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext === "otf" ? "opentype" : ext === "ttc" ? "collection" : ext === "woff" ? "woff" : ext === "woff2" ? "woff2" : "truetype";
}

/** Loads the style fonts once; loadFont blocks the render until they are ready. */
export function ensureFonts(fonts: RenderProps["fonts"]): void {
  for (const [family, path] of [[CAPTION_FONT, fonts.caption], [TITLE_FONT, fonts.title]] as const) {
    const key = `${family}:${path}`;
    if (!path || requested.has(key)) continue;
    requested.add(key);
    // Remotion types list four formats; "collection" is a valid CSS format hint all the same.
    void loadFont({ family, url: src(path), format: fontFormat(path) as "truetype" });
  }
}
