import { describe, expect, it } from "vitest";
import { parseProject } from "../src/parse";
import { resolve } from "../src/resolve";
import { applySeries, parseSeries } from "../src/series";
import { makeProject, makeStyle } from "./helpers";

const series = parseSeries({
  version: 1, name: "Project Adam", style: "style.json",
  assets: [{ id: "whoosh", kind: "audio", path: "assets/whoosh.wav" }, { id: "card", kind: "image", path: "C:/abs/card.png" }],
  vars: { tagline: "Adam builds" },
  treatments: {
    start: [{ id: "title", kind: "title", durationMs: 2000, props: { phases: [{ startMs: 0, endMs: 2000, lines: [{ text: "{{project.name}}: {{tagline}}" }] }] } }],
    transition: [{ id: "sfx", kind: "sfx", durationMs: 400, offsetMs: -100, props: { asset: "whoosh" } }],
    beat: [{ id: "word", kind: "text.behindSubject", layer: "behind-subject", durationMs: 1200, props: { text: "{{beat.word}}" } }],
    end: [{ id: "card", kind: "image", durationMs: 1500, offsetMs: -1500, props: { asset: "card" } }],
  },
});
if (!series.ok) throw new Error(JSON.stringify(series.errors));

const project = makeProject({
  name: "Episode 3",
  assets: [{ id: "a", kind: "video", path: "a.mp4", meta: { durationMs: 30000, hasAudio: true } }, { id: "card", kind: "image", path: "old/card.png" }],
  story: [{ id: "c1", asset: "a", inMs: 0, outMs: 5000 }, { id: "c2", asset: "a", inMs: 6000, outMs: 10000 }],
  structure: { framework: "custom", beats: [{ role: "hook", from: "a.w0", to: "a.w2" }, { role: "build", from: "a.w3", to: "a.w9" }] },
  elements: [{ id: "mine", kind: "image", anchor: { atMs: 0 }, durationMs: 500, props: { asset: "card" } }],
} as never);

describe("applySeries", () => {
  const out = applySeries(project, series.value, "C:/series/Project Adam");
  const byId = (id: string) => out.elements.find((e) => e.id === id)!;

  it("links the style and the series assets", () => {
    expect(out.style).toBe("C:/series/Project Adam/style.json");
    expect(out.assets.find((a) => a.id === "whoosh")!.path).toBe("C:/series/Project Adam/assets/whoosh.wav");
    expect(out.assets.find((a) => a.id === "card")!.path).toBe("C:/abs/card.png");
  });

  it("anchors treatments on words so they follow later edits", () => {
    expect(byId("series.start.0.title")).toMatchObject({ anchor: { atMs: 0 }, props: { phases: [{ lines: [{ text: "Episode 3: Adam builds" }] }] } });
    expect(byId("series.transition.0.sfx").anchor).toEqual({ word: "a.w7", offsetMs: -700 });
    expect(byId("series.beat.0.word")).toMatchObject({ anchor: { word: "a.w0", offsetMs: 0 }, props: { text: "zero" } });
    expect(byId("series.beat.1.word")).toMatchObject({ anchor: { word: "a.w3", offsetMs: 0 }, props: { text: "trois" } });
    expect(byId("series.end.0.card").anchor).toEqual({ word: "a.w9", offsetMs: 300 });
    expect(byId("mine")).toBeDefined();
  });

  it("re-applies without duplicates and gives a valid, resolvable project", () => {
    const again = applySeries(out, series.value, "C:/series/Project Adam");
    expect(again.elements.length).toBe(out.elements.length);
    expect(again.assets.length).toBe(out.assets.length);
    const parsed = parseProject(JSON.parse(JSON.stringify(again)));
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors)).toBe(true);
    expect(resolve(again, makeStyle()).elements.some((e) => e.id === "series.end.0.card")).toBe(true);
  });

  it("refuses an invalid series", () => {
    expect(parseSeries({ version: 1, name: "x", style: "s.json", treatments: { start: [{ id: "t", kind: "title" }] } }).ok).toBe(false);
  });
});
