import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinterestBoards, syncPinterestBoard } from "../src/pinterest";

const pin = (id: string) => ({ id, title: `Pin ${id}`, description: "neon HUD", link: "https://example.com", media: { media_type: "image", images: { "1200x": { url: `https://i.pinimg.com/${id}.jpg` } } } });

function fakePinterest() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push(url);
    const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
    if (url.startsWith("https://i.pinimg.com/")) return new Response(new Uint8Array([255, 216, 255]), { status: 200 });
    expect(init?.headers?.Authorization).toBe("Bearer test-token");
    if (url.includes("/boards/b1/pins") && url.includes("bookmark=next")) return json({ items: [pin("3")], bookmark: null });
    if (url.includes("/boards/b1/pins")) return json({ items: [pin("1"), pin("2")], bookmark: "next" });
    if (url.includes("/boards/b1")) return json({ id: "b1", name: "HUD / refs" });
    if (url.includes("/boards")) return json({ items: [{ id: "b1", name: "HUD / refs", pin_count: 3 }], bookmark: null });
    return new Response("{}", { status: 404 });
  });
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); delete process.env.PINTEREST_ACCESS_TOKEN; });

describe("pinterest", () => {
  it("lists boards and syncs every page of a board once", async () => {
    process.env.PINTEREST_ACCESS_TOKEN = "test-token";
    fakePinterest();
    expect(await pinterestBoards()).toEqual([{ id: "b1", name: "HUD / refs", pins: 3, description: "" }]);
    const root = mkdtempSync(join(tmpdir(), "adam pin-"));
    const r = await syncPinterestBoard("b1", root);
    expect(r).toMatchObject({ added: 3, total: 3 });
    expect(r.folder).toBe(join(root, "Pinterest", "HUD - refs"));
    expect(readFileSync(join(r.folder, "2.jpg.txt"), "utf8")).toContain("neon HUD");
    expect(existsSync(join(r.folder, "3.jpg"))).toBe(true);
    expect((await syncPinterestBoard("b1", root)).added).toBe(0);
  });

  it("says how to connect when there is no token", async () => {
    await expect(pinterestBoards()).rejects.toThrow(/not connected|PINTEREST/);
  });
});
