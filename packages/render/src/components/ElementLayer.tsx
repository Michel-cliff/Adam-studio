import type { FC } from "react";
import { Sequence } from "remotion";
import type { Timeline, TimelineElement } from "@adam-studio/model";
import type { MediaFiles } from "../props";
import { BigWord } from "./BigWord";
import { ImageElement } from "./ImageElement";
import { Title } from "./Title";

/** The elements of one layer; `only` keeps the listed element ids (CapCut overlays). */
export const ElementLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles>; layer: "front" | "behind-subject"; only?: string[] }> = ({
  timeline, media, layer, only,
}) => (
  <>
    {timeline.elements
      .filter((e) => e.layer === layer && (!only || only.includes(e.id)))
      .map((el) => (
        <Sequence key={el.id} from={el.fromFrame} durationInFrames={el.durationFrames} layout="none">
          <ElementView el={el} timeline={timeline} media={media} />
        </Sequence>
      ))}
  </>
);

const ElementView: FC<{ el: TimelineElement; timeline: Timeline; media: Record<string, MediaFiles> }> = ({ el, timeline, media }) => {
  switch (el.kind) {
    case "title":
      return <Title el={el} style={timeline.style} />;
    case "text.behindSubject":
      return <BigWord el={el} style={timeline.style} />;
    case "image":
      return <ImageElement el={el} media={media} />;
    default:
      return null;
  }
};
