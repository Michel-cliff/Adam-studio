import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import { useEffect, useState, type FC } from "react";
import { cancelRender, continueRender, delayRender, useVideoConfig } from "remotion";
import type { LottieProps, Style, TimelineElement } from "@adam-studio/model";
import { src } from "../lib/src";
import type { MediaFiles } from "../props";

/** A Lottie animation (JSON asset) at its slot, sized as a fraction of the canvas width. */
export const LottieElement: FC<{ el: TimelineElement; style: Style; media: Record<string, MediaFiles> }> = ({ el, style, media }) => {
  const { width, height } = useVideoConfig();
  const p = el.props as LottieProps;
  const file = media[p.asset]?.file;
  const [data, setData] = useState<LottieAnimationData | null>(null);
  const [handle] = useState(() => delayRender(`lottie ${p.asset}`));
  useEffect(() => {
    if (!file) {
      continueRender(handle);
      return;
    }
    fetch(src(file))
      .then((r) => r.json())
      .then((json) => {
        setData(json);
        continueRender(handle);
      })
      .catch((e) => cancelRender(e));
  }, [file, handle]);
  if (!data) return null;
  const w = width * (p.width ?? 0.5);
  return (
    <div style={{ position: "absolute", left: el.x * width - w / 2, top: el.y * height, width: w, transform: "translateY(-50%)" }}>
      <Lottie animationData={data} loop={p.loop} playbackRate={(p.playbackRate ?? 1) * (style.motion?.speed ?? 1)} />
    </div>
  );
};
