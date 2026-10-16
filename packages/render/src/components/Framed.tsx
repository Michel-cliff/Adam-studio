import type { CSSProperties, FC, ReactNode } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Framing } from "@adam-studio/model";
import { cropBox, cropRectAt, type Size } from "../lib/framing";

type Render = (style: CSSProperties) => ReactNode;

/**
 * Draws media with a clip's framing and zoom; `render` returns the media element filling the given style.
 * `source` is the media's pixel size; unknown, it is assumed to have the canvas's shape.
 */
export const Framed: FC<{ framing: Framing; zoom: number; sourceMs: number; source?: Size; render: Render; renderSecond?: Render }> = ({
  framing, zoom, sourceMs, source, render, renderSecond,
}) => {
  const { width, height } = useVideoConfig();
  const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  const zoomed = (node: ReactNode) => <AbsoluteFill style={{ transform: `scale(${zoom})` }}>{node}</AbsoluteFill>;
  switch (framing.mode) {
    case "cover":
      return zoomed(render(fill));
    case "fit":
      return (
        <AbsoluteFill>
          {framing.background === "blur" ? (
            <AbsoluteFill style={{ filter: "blur(40px)", transform: "scale(1.15)" }}>{render(fill)}</AbsoluteFill>
          ) : (
            <AbsoluteFill style={{ backgroundColor: framing.color ?? "black" }} />
          )}
          {zoomed(render({ ...fill, objectFit: "contain" }))}
        </AbsoluteFill>
      );
    case "crop": {
      const canvas = { width, height };
      const box = cropBox(cropRectAt(framing, sourceMs), source ?? canvas, canvas);
      return zoomed(render({ position: "absolute", ...box, objectFit: "fill" }));
    }
    case "split": {
      const sideBySide = framing.layout === "left-right";
      const half: CSSProperties = sideBySide
        ? { width: "50%", height: "100%", position: "relative", overflow: "hidden" }
        : { width: "100%", height: "50%", position: "relative", overflow: "hidden" };
      return (
        <AbsoluteFill style={{ display: "flex", flexDirection: sideBySide ? "row" : "column" }}>
          <div style={half}>{zoomed(render(fill))}</div>
          <div style={half}>{renderSecond ? renderSecond(fill) : null}</div>
        </AbsoluteFill>
      );
    }
  }
};
