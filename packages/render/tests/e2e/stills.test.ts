import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve, type Style } from "@adam-studio/model";
import { bundleWithMedia, renderFrame } from "../../src/engine";
import { planMedia } from "../../src/media";
import type { RenderProps } from "../../src/props";
import { projectInput } from "../unit/helpers";
import { makeSynthetic } from "./synthetic";

let dir: string;
let serveUrl: string;
let props: RenderProps;
let style: Style;
let shots = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "adam e2e-"));
  makeSynthetic(dir);
  const p = parseProject(JSON.parse(readFileSync(join(dir, "project.json"), "utf8")));
  const s = parseStyle(JSON.parse(readFileSync(join(dir, "style.json"), "utf8")));
  if (!p.ok || !s.ok) throw new Error("synthetic project is invalid");
  style = s.value;
  const timeline = resolve(p.value, style);
  const plan = planMedia(dir, p.value, timeline);
  serveUrl = await bundleWithMedia(plan, join(dir, "renders", ".bundle"));
  props = { timeline, media: plan.media, fonts: plan.fonts };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function pixels(frame: number, points: [number, number][], p: RenderProps = props): Promise<number[][]> {
  const out = join(dir, `frame-${frame}-${++shots}.png`);
  await renderFrame(serveUrl, p, frame, out);
  const png = PNG.sync.read(readFileSync(out));
  return points.map(([x, y]) => {
    const i = (png.width * y + x) * 4;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
  });
}

function near(actual: number[], expected: number[], tol = 40) {
  actual.forEach((v, i) => expect(Math.abs(v - expected[i]!), `channel ${i}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol));
}

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const GREEN = [0, 255, 0];
const MAGENTA = [255, 0, 255];
const GRAY = [128, 128, 128];

describe("composition", () => {
  it("draws the clip with the subject in front of a behind-subject element", async () => {
    const [corner, center] = await pixels(15, [[50, 50], [540, 960]]);
    near(corner!, MAGENTA);
    near(center!, GREEN);
  });

  it("draws the clip alone when nothing else is active", async () => {
    const [left, right] = await pixels(40, [[50, 50], [1030, 50]]);
    near(left!, RED);
    near(right!, BLUE);
  });

  it("shows the plate behind a subject that slides in from the right", async () => {
    const [corner, center] = await pixels(61, [[50, 50], [540, 960]]);
    near(corner!, GRAY);
    near(center!, GRAY);
  });

  it("returns to the plain clip after the slide", async () => {
    const [left] = await pixels(75, [[300, 960]]);
    near(left!, RED);
  });

  it("keeps the element behind the subject visible with fit framing", async () => {
    // The subject layer must not repeat the fit background over the behind-subject element.
    const p = parseProject({
      ...projectInput(),
      story: [
        { id: "c1", asset: "s", inMs: 0, outMs: 2000, framing: { mode: "fit", background: "color", color: "#FFFF00" }, transitionOut: { kind: "subjectSlide", durationMs: 600 } },
        { id: "c2", asset: "s", inMs: 2000, outMs: 4000 },
      ],
    });
    if (!p.ok) throw new Error("fit project is invalid");
    const fitted = { ...props, timeline: resolve(p.value, style) };
    const [corner, center] = await pixels(15, [[50, 50], [540, 960]], fitted);
    near(corner!, MAGENTA);
    near(center!, GREEN);
  });

  it("crops to a rect of the source frame", async () => {
    // c2 is cropped to the blue half; the same public files serve this second timeline.
    const p = parseProject({
      ...projectInput(),
      story: [
        { id: "c1", asset: "s", inMs: 0, outMs: 2000 },
        { id: "c2", asset: "s", inMs: 2000, outMs: 4000, framing: { mode: "crop", rect: { x: 0.5, y: 0, w: 0.5, h: 1 } } },
      ],
    });
    if (!p.ok) throw new Error("crop project is invalid");
    const cropped = { ...props, timeline: resolve(p.value, style) };
    const [left, right] = await pixels(61, [[50, 960], [1030, 960]], cropped);
    near(left!, BLUE);
    near(right!, BLUE);
  });
});
