import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { AudioLayer } from "./components/AudioLayer";
import { Captions } from "./components/Captions";
import { ClipLayer } from "./components/ClipLayer";
import { ElementLayer } from "./components/ElementLayer";
import { SubjectLayer } from "./components/SubjectLayer";
import { ensureFonts } from "./fonts";
import { GRADE_FILTER_ID, gradeFilter, vignetteBackground, warmthMatrix } from "./lib/grade";
import { slideWindows, subjectWindows } from "./lib/subject";
import type { RenderProps } from "./props";

export const Edit: FC<RenderProps> = (props) => {
  ensureFonts(props.fonts);
  const { timeline, media } = props;
  const grade = timeline.style.grade;
  const filter = gradeFilter(grade, GRADE_FILTER_ID);
  const slides = slideWindows(timeline);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={GRADE_FILTER_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={warmthMatrix(grade.warmth).join(" ")} />
        </filter>
      </svg>
      <AbsoluteFill style={{ filter }}>
        <ClipLayer timeline={timeline} media={media} slides={slides} />
      </AbsoluteFill>
      <ElementLayer timeline={timeline} media={media} layer="behind-subject" />
      <AbsoluteFill style={{ filter }}>
        <SubjectLayer timeline={timeline} media={media} windows={subjectWindows(timeline)} slides={slides} />
      </AbsoluteFill>
      {grade.vignette > 0 ? <AbsoluteFill style={{ background: vignetteBackground(grade.vignette) }} /> : null}
      <ElementLayer timeline={timeline} media={media} layer="front" />
      <Captions timeline={timeline} />
      <AudioLayer timeline={timeline} media={media} />
    </AbsoluteFill>
  );
};
