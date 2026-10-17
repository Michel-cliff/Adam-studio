import type { FC } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { HudStatProps, Style, TimelineElement } from "@adam-studio/model";
import { colorOf, easeOutCubic, exitOpacity } from "../lib/text";
import { TITLE_FONT } from "../props";

/** A number counting up to its value, with a label under it. */
export const HudStat: FC<{ el: TimelineElement; style: Style }> = ({ el, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const p = el.props as HudStatProps;
  const speed = style.motion?.speed ?? 1;
  const ms = ((frame * 1000) / fps + el.trimStartMs) * speed;
  const totalMs = ((el.durationFrames * 1000) / fps + el.trimStartMs) * speed;
  const k = easeOutCubic(ms / (p.countMs ?? 900));
  const from = p.from ?? 0;
  const value = (from + (p.value - from) * k).toFixed(p.decimals ?? 0);
  const size = width * 0.16;
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(ms, totalMs, 200) * easeOutCubic(ms / 150) }}>
      <div
        style={{
          position: "absolute", left: 0, width, top: el.y * height, textAlign: "center",
          transform: `translate(${(el.x - 0.5) * width}px, -50%) scale(${0.92 + 0.08 * easeOutCubic(ms / 250)})`,
        }}
      >
        <div style={{ fontFamily: TITLE_FONT, fontSize: size, lineHeight: 1, color: colorOf(p.color ?? "accent", style), letterSpacing: "-0.03em", textShadow: "0 4px 24px rgba(0,0,0,0.45)" }}>
          {p.prefix}
          {value}
          {p.suffix}
        </div>
        <div
          style={{
            fontFamily: "Consolas, 'Courier New', monospace", fontSize: size * 0.2, color: style.colors.text, letterSpacing: "0.12em",
            textTransform: "uppercase", marginTop: size * 0.08, textShadow: "0 2px 10px rgba(0,0,0,0.6)",
          }}
        >
          {p.label}
        </div>
      </div>
    </AbsoluteFill>
  );
};
