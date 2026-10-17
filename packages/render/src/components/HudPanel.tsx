import type { FC } from "react";
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import type { HudPanelProps, Style, TimelineElement } from "@adam-studio/model";
import { src } from "../lib/src";
import { colorOf, easeOutCubic, exitOpacity } from "../lib/text";
import { TITLE_FONT, type MediaFiles } from "../props";

const MONO = "Consolas, 'Courier New', monospace";

/** A HUD window: header bar with the title, lines typed in, an optional image; opens from its centre line. */
export const HudPanel: FC<{ el: TimelineElement; style: Style; media: Record<string, MediaFiles> }> = ({ el, style, media }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const p = el.props as HudPanelProps;
  const speed = style.motion?.speed ?? 1;
  const ms = ((frame * 1000) / fps + el.trimStartMs) * speed;
  const totalMs = ((el.durationFrames * 1000) / fps + el.trimStartMs) * speed;
  const color = colorOf(p.color ?? "accent", style);
  const open = easeOutCubic(ms / 260);
  const w = width * (p.width ?? 0.8);
  const unit = width * 0.03;
  const image = p.asset ? media[p.asset]?.file : undefined;
  const typed = (i: number, text: string) => {
    if (p.typing === false) return text;
    return text.slice(0, Math.max(0, Math.floor((ms - 320 - i * 260) / 28)));
  };
  const scan = ((ms / 6) % 100).toFixed(1);
  return (
    <AbsoluteFill style={{ opacity: exitOpacity(ms, totalMs, 200) }}>
      <div
        style={{
          position: "absolute", left: el.x * width - w / 2, top: el.y * height, width: w,
          transform: `translateY(-50%) scaleY(${0.04 + 0.96 * open})`,
          background: "rgba(8, 10, 14, 0.82)", border: `${Math.max(2, unit * 0.12)}px solid ${color}`, boxShadow: `0 0 ${unit}px ${color}55`,
          fontFamily: MONO, color: "#E8F1F2", overflow: "hidden",
        }}
      >
        <div
          style={{
            background: color, color: style.colors.ink, fontFamily: TITLE_FONT, fontSize: unit * 0.9, padding: `${unit * 0.25}px ${unit * 0.5}px`,
            letterSpacing: "0.08em", display: "flex", justifyContent: "space-between",
          }}
        >
          <span>{p.title}</span>
          <span>{"●"} LIVE</span>
        </div>
        {image ? <Img src={src(image)} style={{ display: "block", width: "100%", opacity: easeOutCubic((ms - 200) / 300) }} /> : null}
        <div style={{ padding: unit * 0.6, fontSize: unit * 0.85, lineHeight: 1.45, minHeight: unit }}>
          {(p.lines ?? []).map((line, i) => (
            <div key={i}>{"> "}{typed(i, line)}</div>
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: `${scan}%`, height: 2, background: `${color}66` }} />
      </div>
    </AbsoluteFill>
  );
};
