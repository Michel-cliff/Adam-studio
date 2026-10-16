import type { FC } from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Timeline, TimelineClip } from "@adam-studio/model";
import { zoomAt } from "../lib/framing";
import { slideOffset, type SlideWindow, type SubjectWindow } from "../lib/subject";
import type { MediaFiles } from "../props";
import { Framed } from "./Framed";

export const SubjectLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles>; windows: SubjectWindow[]; slides: SlideWindow[] }> = ({
  timeline, media, windows, slides,
}) => {
  const clips = new Map(timeline.clips.map((c) => [c.id, c]));
  return (
    <>
      {windows.map((w) => {
        const clip = clips.get(w.clipId)!;
        return (
          <Sequence key={`${w.clipId}:${w.fromFrame}`} from={w.fromFrame} durationInFrames={w.toFrame - w.fromFrame} layout="none">
            <SubjectFrame clip={clip} files={media[clip.asset] ?? {}} startFrame={w.fromFrame} slides={slides.filter((s) => s.clipId === clip.id)} />
          </Sequence>
        );
      })}
    </>
  );
};

const SubjectFrame: FC<{ clip: TimelineClip; files: MediaFiles; startFrame: number; slides: SlideWindow[] }> = ({ clip, files, startFrame, slides }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  if (!files.subject) return null;
  const abs = startFrame + frame;
  const elapsedMs = ((abs - clip.fromFrame) * 1000) / fps;
  // The window can start after the clip: skip the source frames already played.
  const trimBefore = Math.round((clip.sourceInMs * fps) / 1000) + (startFrame - clip.fromFrame);
  const slide = slides.find((s) => abs >= s.fromFrame && abs < s.toFrame);
  const { dx, blurPx } = slide ? slideOffset(slide, abs, width) : { dx: 0, blurPx: 0 };
  const blurId = `adam-slide-${clip.id}-${abs}`;
  return (
    <AbsoluteFill style={{ transform: `translateX(${dx}px)`, filter: blurPx > 0.5 ? `url(#${blurId})` : undefined }}>
      {blurPx > 0.5 ? (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={blurId} x="-50%" width="200%">
            <feGaussianBlur stdDeviation={`${blurPx / 2} 0`} />
          </filter>
        </svg>
      ) : null}
      <Framed
        framing={clip.framing}
        zoom={zoomAt(clip.zoom, elapsedMs)}
        sourceMs={clip.sourceInMs + elapsedMs}
        source={files.width && files.height ? { width: files.width, height: files.height } : undefined}
        bare
        render={(style) => <OffthreadVideo src={staticFile(files.subject!)} trimBefore={trimBefore} muted transparent style={style} />}
      />
    </AbsoluteFill>
  );
};
