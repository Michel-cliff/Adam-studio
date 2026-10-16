import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve } from "@adam-studio/model";
import { MediaError, expandEnv, mergePlans, planMedia, prepareMedia } from "../../src/media";
import { projectInput, styleInput } from "./helpers";

let dir: string;
const touch = (rel: string, content = rel) => {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};

function setup() {
  const p = parseProject(projectInput());
  const s = parseStyle({ ...styleInput, fonts: { caption: { family: "C", file: "fonts-src/c.ttf" }, title: { family: "T", file: "fonts-src/t.otf" } } });
  if (!p.ok || !s.ok) throw new Error("bad fixture");
  return { project: p.value, timeline: resolve(p.value, s.value) };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adam media-"));
  for (const f of ["cache/s/edit.mp4", "cache/s/subject.webm", "cache/s/plate.png", "assets-src/magenta.png", "assets-src/beep.wav", "fonts-src/c.ttf", "fonts-src/t.otf"]) touch(f);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("planMedia", () => {
  it("lists every file the timeline needs, with public paths per asset", () => {
    const { project, timeline } = setup();
    const plan = planMedia(dir, project, timeline);
    expect(plan.media).toEqual({
      s: { video: "cache/s/edit.mp4", subject: "cache/s/subject.webm", plate: "cache/s/plate.png", width: 1080, height: 1920 },
      m: { file: "assets/m.png" },
      b: { file: "assets/b.wav" },
    });
    expect(plan.fonts.caption).toMatch(/^fonts\/caption-[0-9a-f]{8}\.ttf$/);
    expect(plan.fonts.title).toMatch(/^fonts\/title-[0-9a-f]{8}\.otf$/);
    expect(plan.files.map((f) => f.to).sort()).toEqual(
      ["assets/b.wav", "assets/m.png", "cache/s/edit.mp4", "cache/s/plate.png", "cache/s/subject.webm", plan.fonts.caption, plan.fonts.title].sort(),
    );
  });

  it("gives each font file its own public name, so variants with different fonts share one public dir", () => {
    const { project, timeline } = setup();
    touch("fonts-src/other.ttf");
    const other = { ...timeline, style: { ...timeline.style, fonts: { ...timeline.style.fonts, caption: { family: "O", file: "fonts-src/other.ttf" } } } };
    const a = planMedia(dir, project, timeline);
    const b = planMedia(dir, project, other);
    expect(a.fonts.caption).not.toBe(b.fonts.caption);
    expect(a.fonts.title).toBe(b.fonts.title);
    expect(mergePlans([a, b]).files.map((f) => f.to)).toEqual(expect.arrayContaining([a.fonts.caption, b.fonts.caption]));
  });

  it("prefers proxy.mp4 for previews, and falls back to edit.mp4", () => {
    const { project, timeline } = setup();
    expect(planMedia(dir, project, timeline, { preview: true }).media.s!.video).toBe("cache/s/edit.mp4");
    touch("cache/s/proxy.mp4");
    expect(planMedia(dir, project, timeline, { preview: true }).media.s!.video).toBe("cache/s/proxy.mp4");
    expect(planMedia(dir, project, timeline).media.s!.video).toBe("cache/s/edit.mp4");
  });

  it("names missing files and the analysis step to run", () => {
    rmSync(join(dir, "cache/s/plate.png"));
    rmSync(join(dir, "cache/s/subject.webm"));
    const { project, timeline } = setup();
    expect(() => planMedia(dir, project, timeline)).toThrow(MediaError);
    try {
      planMedia(dir, project, timeline);
    } catch (e) {
      expect((e as Error).message).toContain('cache/s/subject.webm for asset "s" (run the matting analysis step)');
      expect((e as Error).message).toContain('cache/s/plate.png for asset "s" (run the clean plate analysis step)');
    }
  });
});

describe("prepareMedia", () => {
  it("fills the public dir with the planned files", () => {
    const { project, timeline } = setup();
    const plan = planMedia(dir, project, timeline);
    const pub = join(dir, "renders", ".public");
    prepareMedia(plan, pub);
    expect(readFileSync(join(pub, "cache/s/edit.mp4"), "utf8")).toBe("cache/s/edit.mp4");
    expect(readFileSync(join(pub, plan.fonts.title), "utf8")).toBe("fonts-src/t.otf");
  });
});

describe("mergePlans", () => {
  it("unions files and media of several plans", () => {
    const a = { files: [{ from: "x", to: "cache/s/edit.mp4" }], media: { s: { video: "cache/s/edit.mp4" } }, fonts: { caption: "c", title: "t" } };
    const b = { files: [{ from: "y", to: "assets/m.png" }], media: { m: { file: "assets/m.png" } }, fonts: { caption: "c", title: "t" } };
    const m = mergePlans([a, b]);
    expect(m.files.map((f) => f.to)).toEqual(["cache/s/edit.mp4", "assets/m.png"]);
    expect(m.media).toEqual({ s: { video: "cache/s/edit.mp4" }, m: { file: "assets/m.png" } });
  });
});

describe("expandEnv", () => {
  it("expands Windows-style %VARS%", () => {
    process.env.ADAM_TEST_DIR = "C:/x";
    expect(expandEnv("%ADAM_TEST_DIR%/fonts/a.ttf")).toBe("C:/x/fonts/a.ttf");
    expect(expandEnv("%ADAM_NOPE%/a")).toBe("%ADAM_NOPE%/a");
  });
});
