import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { reviewCommand } from "../../src/commands/review";
import { makeSynthetic } from "./synthetic";

function pixel(file: string, x: number, y: number): number[] {
  const png = PNG.sync.read(readFileSync(file));
  const i = (png.width * y + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

describe("adam review", () => {
  it("renders a preview, a still, a labelled sheet and an index per variant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam review-"));
    makeSynthetic(dir, { withProposal: true });
    const [folder] = await reviewCommand(dir);
    for (const f of ["A.mp4", "B.mp4", "A.png", "B.png", "sheet.jpg", "index.json"]) expect(existsSync(join(folder!, f)), f).toBe(true);
    const a = pixel(join(folder!, "A.png"), 50, 50);
    const b = pixel(join(folder!, "B.png"), 50, 50);
    expect(a[0]! > 200 && a[1]! < 60 && a[2]! > 200, `A should show the magenta element, got ${a}`).toBe(true);
    expect(b[0]! > 200 && b[1]! < 60 && b[2]! < 60, `B should show the red take, got ${b}`).toBe(true);
    const index = JSON.parse(readFileSync(join(folder!, "index.json"), "utf8"));
    expect(index.variants.map((v: { key: string }) => v.key)).toEqual(["A", "B"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
