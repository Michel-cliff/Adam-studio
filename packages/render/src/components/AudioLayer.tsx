import { src as mediaSrc } from "../lib/src";
import type { FC } from "react";
import { Html5Audio, Sequence, useVideoConfig } from "remotion";
import type { Timeline, TimelineAudio } from "@adam-studio/model";
import { audioVolume } from "../lib/audio";
import type { MediaFiles } from "../props";

/** Clip audio and sound effects; `clipAudioOnly` leaves the sound effects to CapCut (baked stretches). */
export const AudioLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles>; clipAudioOnly?: boolean }> = ({ timeline, media, clipAudioOnly }) => (
  <>
    {timeline.audio
      .filter((a) => !clipAudioOnly || a.id.startsWith("clip:"))
      .map((a) => {
        const files = media[a.asset] ?? {};
        const src = files.video ?? files.file;
        if (!src || a.durationFrames < 1) return null;
        return (
          <Sequence key={a.id} from={a.fromFrame} durationInFrames={a.durationFrames} layout="none">
            <AudioItem src={src} item={a} />
          </Sequence>
        );
      })}
  </>
);

const AudioItem: FC<{ src: string; item: TimelineAudio }> = ({ src, item }) => {
  const { fps } = useVideoConfig();
  // The volume callback receives the frame counted from the start of this audio, as audioVolume expects.
  return <Html5Audio src={mediaSrc(src)} trimBefore={Math.round((item.sourceInMs * fps) / 1000)} volume={(f) => audioVolume(item, f, fps)} />;
};
