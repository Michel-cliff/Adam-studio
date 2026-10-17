import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeProject } from "../../model/tests/helpers";
import { instagramVideos, tiktokAuthUrl, tiktokVideos } from "../src/platforms";
import { compare, features, link, mergeVideos, rank, readInsights, writeInsights, type InsightsData } from "../src/report";

afterEach(() => { vi.unstubAllGlobals(); delete process.env.INSTAGRAM_ACCESS_TOKEN; delete process.env.TIKTOK_CLIENT_KEY; });

const video = (id: string, views: number, likes: number) => ({ platform: "tiktok" as const, id, caption: id, url: "", cover: "", publishedAt: "2026-10-01T00:00:00Z", views, likes, comments: 0, shares: 0, saves: 0 });

describe("features of an edit", () => {
  it("measures length, pacing, hook and effects", () => {
    const p = makeProject({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 3000 }, { id: "c2", asset: "a", inMs: 4000, outMs: 9000 }],
      structure: { framework: "hook-value-cta", beats: [{ role: "hook", from: "a.w0", to: "a.w1" }] },
    } as never);
    const f = features(p);
    expect(f).toMatchObject({ durationS: 8, cutsPerMin: 7.5, hookS: 2.3, framework: "hook-value-cta", series: null });
    expect(f.wordsPerMin).toBeGreaterThan(0);
  });
});

describe("ranking", () => {
  it("ranks by views, keeps links across refreshes and compares linked edits", () => {
    let d: InsightsData = { fetchedAt: {}, videos: [], links: {} };
    d = mergeVideos(d, "tiktok", [video("a", 1000, 100), video("b", 5000, 50), video("c", 200, 40)]);
    d = link(link(link(d, "tiktok:a", "ep1"), "tiktok:b", "ep2"), "tiktok:c", "ep3");
    d = mergeVideos(d, "tiktok", [video("a", 1200, 120), video("b", 5000, 50), video("c", 200, 40)]);
    const feats: Record<string, number> = { ep1: 30, ep2: 20, ep3: 40 };
    const rows = rank(d, (p) => ({ durationS: feats[p]!, cutsPerMin: 10, hookS: null, framework: "x", series: null, elements: {}, captions: true, wordsPerMin: 150 }));
    expect(rows.map((r) => [r.id, r.views, r.engagement, r.project])).toEqual([["b", 5000, 0.01, "ep2"], ["a", 1200, 0.1, "ep1"], ["c", 200, 0.2, "ep3"]]);
    const dur = compare(rows).find((c) => c.feature === "durationS")!;
    expect(dur.groups).toEqual([
      { label: "durationS <= 30", videos: 2, medianViews: 3100, medianEngagement: 0.055 },
      { label: "durationS > 30", videos: 1, medianViews: 200, medianEngagement: 0.2 },
    ]);
    const file = join(mkdtempSync(join(tmpdir(), "adam insights-")), "insights.json");
    writeInsights(d, file);
    expect(readInsights(file).links["tiktok:a"]).toBe("ep1");
  });
});

describe("platforms", () => {
  it("reads every page of the TikTok video list", async () => {
    process.env.ADAM_STUDIO_HOME = mkdtempSync(join(tmpdir(), "adam home-"));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(process.env.ADAM_STUDIO_HOME, "tokens.json"), JSON.stringify({ tiktok: { access_token: "t", expires_at: Date.now() + 3600e3 } }));
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const page = body.cursor ? [{ id: 2, video_description: "deux", view_count: 20, create_time: 1700000000 }] : [{ id: 1, title: "un", view_count: 10, like_count: 1, duration: 30, create_time: 1700000000 }];
      return new Response(JSON.stringify({ data: { videos: page, has_more: !body.cursor, cursor: 99 }, error: { code: "ok" } }));
    });
    const v = await tiktokVideos();
    expect(v.map((x) => [x.id, x.caption, x.views, x.durationMs])).toEqual([["1", "un", 10, 30000], ["2", "deux", 20, undefined]]);
  });

  it("falls back to fewer Instagram metrics when one is refused", async () => {
    process.env.ADAM_STUDIO_HOME = mkdtempSync(join(tmpdir(), "adam home-"));
    process.env.INSTAGRAM_ACCESS_TOKEN = "ig";
    vi.stubGlobal("fetch", async (url: string) => {
      const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
      if (url.includes("refresh_access_token")) return json({ access_token: "ig2", expires_in: 5184000 });
      if (url.includes("/me/media")) return json({ data: [{ id: "m1", media_type: "VIDEO", media_product_type: "REELS", caption: "reel", permalink: "p", timestamp: "t", like_count: 5, comments_count: 2 }, { id: "m2", media_type: "IMAGE" }] });
      if (url.includes("ig_reels_avg_watch_time")) return json({ error: { message: "unsupported metric" } }, 400);
      if (url.includes("/insights")) return json({ data: [{ name: "views", values: [{ value: 300 }] }, { name: "saved", values: [{ value: 7 }] }] });
      return json({}, 404);
    });
    const v = await instagramVideos();
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ id: "m1", views: 300, likes: 5, comments: 2, saves: 7 });
  });

  it("builds the TikTok sign-in link with PKCE", () => {
    process.env.TIKTOK_CLIENT_KEY = "ck";
    const u = new URL(tiktokAuthUrl("http://localhost:4317/api/tiktok/callback"));
    expect(u.searchParams.get("code_challenge")).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get("scope")).toBe("user.info.basic,user.info.stats,video.list");
  });
});
