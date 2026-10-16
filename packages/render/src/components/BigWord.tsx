import type { FC } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { BehindSubjectTextProps, Style, TimelineElement } from "@adam-studio/model";
import { colorOf, exitOpacity, fitFontSize, glitchAmount, lineReveal } from "../lib/text";
import { TITLE_FONT } from "../props";

export const BigWord: FC<{ el: TimelineElement; style: Style }> = ({ el, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const props = el.props as BehindSubjectTextProps;
  const ms = (frame * 1000) / fps + el.trimStartMs;
  const totalMs = (el.durationFrames * 1000) / fps + el.trimStartMs;
  const r = lineReveal(ms, 0, 0, 250, 0);
  const g = glitchAmount(ms, totalMs, 1, 0, 0);
  const size = fitFontSize(props.text, width * 0.92, width * 0.21 * props.sizeScale);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(ms, totalMs) }}>
      <div
        style={{
          position: "absolute", left: (el.x - 0.5) * width, width, top: el.y * height, transform: "translateY(-50%)",
          textAlign: "center", fontFamily: TITLE_FONT, fontSize: size, lineHeight: 1, letterSpacing: "-0.035em", whiteSpace: "nowrap",
          color: colorOf(props.color, style),
          clipPath: `inset(${(1 - r) * 100}% 0 0 0)`,
          textShadow: g > 0 ? `${-6 * g}px 0 rgba(255,0,60,0.8), ${6 * g}px 0 rgba(0,220,255,0.8)` : undefined,
        }}
      >
        {props.text}
      </div>
    </AbsoluteFill>
  );
};
