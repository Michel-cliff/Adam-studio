import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySeriesTo, listSeries, loadSeries, saveSeries } from "../../src/series";
import { makeSynthetic } from "../e2e/synthetic";

let source: string; let target: string; const prev = process.env.ADAM_SERIES;
beforeAll(() => {
  process.env.ADAM_SERIES = mkdtempSync(join(tmpdir(), "adam series-"));
  source = mkdtempSync(join(tmpdir(), "adam series src-"));
  makeSynthetic(source);
  target = mkdtempSync(join(tmpdir(), "adam series dst-"));
  makeSynthetic(target);
}, 120000);
afterAll(() => { if (prev === undefined) delete process.env.ADAM_SERIES; else process.env.ADAM_SERIES = prev; });

describe("series on disk", () => {
  it("saves a project's look as a series and applies it to another project", () => {
    const dir = saveSeries(source, "Projet démo");
    expect(listSeries().map((s) => s.name)).toEqual(["Projet démo"]);
    const { series } = loadSeries("Projet démo");
    expect(series.assets.length).toBeGreaterThan(0);
    for (const a of series.assets) expect(a.path).toMatch(/^assets\//);
    expect(() => saveSeries(source, "Projet démo")).toThrow(/exists/);
    const file = join(dir, "series.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.treatments.end = [{ id: "bye", kind: "image", durationMs: 300, offsetMs: -300, props: { asset: series.assets[0]!.id } }];
    writeFileSync(file, JSON.stringify(raw));
    applySeriesTo(target, "Projet démo");
    applySeriesTo(target, "Projet démo");
    const project = JSON.parse(readFileSync(join(target, "project.json"), "utf8"));
    expect(project.style.endsWith("style.json")).toBe(true);
    expect(project.elements.filter((e: { id: string }) => e.id === "series.end.0.bye")).toHaveLength(1);
    expect(() => applySeriesTo(target, "nope")).toThrow(/no series/);
    expect(() => loadSeries("../x")).toThrow(/not a valid/);
  });
});
