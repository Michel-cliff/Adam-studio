import { staticFile } from "remotion";

/** A public-dir path for renders, or a URL as is (the control panel's live preview serves media itself). */
export function src(path: string): string {
  return /^(https?:)?\//.test(path) ? path : staticFile(path);
}
