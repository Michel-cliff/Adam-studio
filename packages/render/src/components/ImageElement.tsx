import { src } from "../lib/src";
import type { CSSProperties, FC } from "react";
import { Img, useCurrentFrame, useVideoConfig } from "remotion";
import type { ImageProps, TimelineElement } from "@adam-studio/model";
import { presetStyle } from "../lib/presets";
import type { MediaFiles } from "../props";

export const ImageElement: FC<{ el: TimelineElement; media: Record<string, MediaFiles>; speed?: number }> = ({ el, media, speed = 1 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const props = el.props as ImageProps;
  const file = media[props.asset]?.file;
  if (!file) return null;
  const ms = ((frame * 1000) / fps + el.trimStartMs) * speed;
  const totalMs = ((el.durationFrames * 1000) / fps + el.trimStartMs) * speed;
  const intro = presetStyle(props.intro, ms, frame);
  const outro = presetStyle(props.outro, totalMs - ms, frame);
  const box: CSSProperties =
    props.fit === "full"
      ? { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "fill" }
      : { position: "absolute", left: el.x * width, top: el.y * height, maxWidth: "90%", maxHeight: "90%", objectFit: props.fit, translate: "-50% -50%" };
  return (
    <Img
      src={src(file)}
      style={{
        ...box,
        opacity: Math.min(intro.opacity ?? 1, outro.opacity ?? 1),
        transform: [intro.transform, outro.transform].filter(Boolean).join(" ") || undefined,
        filter: [intro.filter, outro.filter].filter(Boolean).join(" ") || undefined,
      }}
    />
  );
};
