import { src } from "../lib/src";
import type { FC } from "react";
import { Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Timeline, TimelineClip } from "@adam-studio/model";
import { zoomAt } from "../lib/framing";
import type { SlideWindow } from "../lib/subject";
import type { MediaFiles } from "../props";
import { Framed } from "./Framed";

type Media = Record<string, MediaFiles>;

/** Story clips back to back; every transition except the person-only slide is a cut (crossfades are done by hand). */
export const ClipLayer: FC<{ timeline: Timeline; media: Media; slides: SlideWindow[] }> = ({ timeline, media, slides }) => (
  <>
    {timeline.clips.map((clip) => (
      <Sequence key={clip.id} from={clip.fromFrame} durationInFrames={clip.durationFrames} layout="none">
        <ClipFrame clip={clip} media={media} slides={slides.filter((s) => s.clipId === clip.id)} />
      </Sequence>
    ))}
  </>
);

const ClipFrame: FC<{ clip: TimelineClip; media: Media; slides: SlideWindow[] }> = ({ clip, media, slides }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const abs = clip.fromFrame + frame;
  const elapsedMs = (frame * 1000) / fps;
  const sourceMs = clip.sourceInMs + elapsedMs;
  const files = media[clip.asset] ?? {};
  const second = clip.framing.mode === "split" ? media[clip.framing.asset] ?? {} : undefined;
  const trimBefore = Math.round((clip.sourceInMs * fps) / 1000);
  const zoom = zoomAt(clip.zoom, elapsedMs);
  const source = files.width && files.height ? { width: files.width, height: files.height } : undefined;
  // During a person-only slide the room without the person replaces the take.
  const inSlide = slides.some((s) => abs >= s.fromFrame && abs < s.toFrame);
  return (
    <>
      <Framed
        framing={clip.framing}
        zoom={zoom}
        sourceMs={sourceMs}
        source={source}
        render={(style) => (files.video ? <OffthreadVideo src={src(files.video)} trimBefore={trimBefore} muted style={style} /> : null)}
        renderSecond={second?.video ? (style) => <OffthreadVideo src={src(second.video!)} trimBefore={trimBefore} muted style={style} /> : undefined}
      />
      {inSlide && files.plate ? (
        <Framed framing={clip.framing} zoom={zoom} sourceMs={sourceMs} source={source} render={(style) => <Img src={src(files.plate!)} style={style} />} />
      ) : null}
    </>
  );
};
