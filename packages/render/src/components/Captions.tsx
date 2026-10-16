import type { FC } from "react";
import { Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Style, Timeline, TimelineCaption } from "@adam-studio/model";
import { captionLines, easeOutCubic } from "../lib/text";
import { CAPTION_FONT } from "../props";

export const Captions: FC<{ timeline: Timeline }> = ({ timeline }) => (
  <>
    {timeline.captions.map((c) => (
      <Sequence key={c.id} from={c.fromFrame} durationInFrames={c.durationFrames} layout="none">
        <CaptionView c={c} style={timeline.style} />
      </Sequence>
    ))}
  </>
);

const CaptionView: FC<{ c: TimelineCaption; style: Style }> = ({ c, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const size = style.caption.size * width;
  const introFrames = Math.max(1, Math.min(Math.round(0.15 * fps), Math.floor(c.durationFrames / 3)));
  const scale = style.caption.intro === "miniZoom" ? 0.85 + 0.15 * easeOutCubic(frame / introFrames) : 1;
  return (
    <div
      style={{
        position: "absolute", left: c.x * width - width * 0.45, width: width * 0.9, top: c.y * height,
        transform: `translateY(-50%) scale(${scale})`, textAlign: "center",
        fontFamily: CAPTION_FONT, fontSize: size, lineHeight: 1.15, color: style.colors.text,
        WebkitTextStroke: `${size * style.caption.stroke * 0.5}px black`, paintOrder: "stroke fill",
        textShadow: style.caption.shadow ? "0 4px 12px rgba(0,0,0,0.55)" : undefined,
      }}
    >
      {captionLines(c.text, c.highlightRanges).map((line, i) => (
        <div key={i}>
          {line.map((s, k) => (
            <span key={k} style={{ color: s.highlight ? style.colors.highlight : undefined }}>
              {s.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};
