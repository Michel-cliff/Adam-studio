import type { Timeline } from "@adam-studio/model";

/**
 * Files of one asset, as paths relative to the render public dir (passed to staticFile()),
 * plus the source's pixel size when the project knows it (crop rects are relative to the source frame).
 */
export type MediaFiles = { video?: string; subject?: string; plate?: string; file?: string; width?: number; height?: number };

export type RenderProps = {
  timeline: Timeline;
  media: Record<string, MediaFiles>;
  fonts: { caption: string; title: string };
};

export const COMPOSITION_ID = "AdamEdit";
export const CAPTION_FONT = "AdamCaption";
export const TITLE_FONT = "AdamTitle";
