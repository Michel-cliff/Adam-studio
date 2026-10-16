import type { FC } from "react";
import { Composition } from "remotion";
import { Edit } from "./Edit";
import { EMPTY_PROPS } from "./empty";
import { COMPOSITION_ID } from "./props";

export const Root: FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={Edit}
    durationInFrames={1}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={EMPTY_PROPS}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, props.timeline.durationFrames),
      fps: props.timeline.fps,
      width: props.timeline.width,
      height: props.timeline.height,
    })}
  />
);
