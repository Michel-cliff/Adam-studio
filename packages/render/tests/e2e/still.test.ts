import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { stillCommand } from "../../src/commands/still";
import { makeSynthetic } from "./synthetic";

function pixel(file: string, x: number, y: number): number[] {
  const png = PNG.sync.read(readFileSync(file));
  const i = (png.width * y + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

describe("adam still", () => {
  it("renders frames of the edit and of a variant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam still-"));
    makeSynthetic(dir, { withProposal: true });
    const plain = await stillCommand(dir, { at: [2300, 1500] });
    expect(plain).toHaveLength(2);
    for (const f of plain) expect(existsSync(f), f).toBe(true);
    const [a] = await stillCommand(dir, { at: [2300], variant: "p1:A" });
    const base = pixel(plain[0]!, 50, 50);
    expect(base[1]! > 60 || base[0]! < 200, `the edit has no magenta element at 2300 ms, got ${base}`).toBe(true);
    const magenta = pixel(a!, 50, 50);
    expect(magenta[0]! > 200 && magenta[1]! < 60 && magenta[2]! > 200, `variant A should show the magenta element, got ${magenta}`).toBe(true);
    await expect(stillCommand(dir, { at: [999999] })).rejects.toThrow(/past the end/);
    rmSync(dir, { recursive: true, force: true });
  });
});
