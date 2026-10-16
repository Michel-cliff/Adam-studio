import type { FC } from "react";
import { Sequence } from "remotion";
import type { Timeline, TimelineElement } from "@adam-studio/model";
import type { MediaFiles } from "../props";
import { BigWord } from "./BigWord";
import { ImageElement } from "./ImageElement";
import { Title } from "./Title";

export const ElementLayer: FC<{ timeline: Timeline; media: Record<string, MediaFiles>; layer: "front" | "behind-subject" }> = ({ timeline, media, layer }) => (
  <>
    {timeline.elements
      .filter((e) => e.layer === layer)
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
