import type { FC } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Style, TimelineElement, TitleProps } from "@adam-studio/model";
import { exitOpacity, fitFontSize, glitchAmount, lineReveal, titleLineColor } from "../lib/text";
import { TITLE_FONT } from "../props";

export const Title: FC<{ el: TimelineElement; style: Style }> = ({ el, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const props = el.props as TitleProps;
  const ms = (frame * 1000) / fps + el.trimStartMs;
  const phase = props.phases.find((p) => ms >= p.startMs && ms < p.endMs);
  if (!phase) return null;
  const local = ms - phase.startMs;
  const phaseMs = phase.endMs - phase.startMs;
  const g = glitchAmount(local, phaseMs, phase.lines.length);
  const jitter = g > 0 ? (((frame * 37) % 11) - 5) * g : 0;
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(local, phaseMs) }}>
      <div
        style={{
          position: "absolute", left: (el.x - 0.5) * width, width, top: el.y * height,
          display: "flex", flexDirection: "column", alignItems: "center", transform: `translate(${jitter}px, -50%)`,
        }}
      >
        {props.kicker && phase === props.phases[0] ? (
          <div style={{ fontFamily: TITLE_FONT, fontSize: width * 0.03, color: style.colors.accent, letterSpacing: "0.2em", marginBottom: width * 0.01 }}>
            {props.kicker}
          </div>
        ) : null}
        {phase.lines.map((line, i) => {
          const r = lineReveal(local, i);
          const size = fitFontSize(line.text, width * 0.9, width * 0.14 * line.sizeScale);
          return (
            <div
              key={i}
              style={{
                fontFamily: TITLE_FONT, fontSize: size, lineHeight: 1, letterSpacing: "-0.035em", whiteSpace: "nowrap",
                color: titleLineColor(line.box, style),
                backgroundColor: line.box ? style.colors.accent : undefined,
                padding: line.box ? `0 ${size * 0.15}px` : undefined,
                transform: `translateY(${(1 - r) * size * 0.3}px)`,
                clipPath: `inset(${(1 - r) * 100}% 0 0 0)`,
                textShadow: g > 0 ? `${-6 * g}px 0 rgba(255,0,60,0.8), ${6 * g}px 0 rgba(0,220,255,0.8)` : undefined,
              }}
            >
              {line.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
