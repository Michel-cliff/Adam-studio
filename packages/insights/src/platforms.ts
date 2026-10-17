import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { apiKey } from "@adam-studio/library/src/online";

/** One published video with its numbers, whatever the platform. */
export type Video = {
  platform: "tiktok" | "instagram"; id: string; caption: string; url: string; cover: string; publishedAt: string; durationMs?: number;
  views: number; likes: number; comments: number; shares: number; saves: number; reach?: number; avgWatchMs?: number;
};

// ADAM_STUDIO_HOME moves the token file (tests).
const dir = () => process.env.ADAM_STUDIO_HOME ?? join(homedir(), ".adam-studio");
const tokensFile = () => join(dir(), "tokens.json");
type Token = { access_token: string; refresh_token?: string; expires_at?: number; open_id?: string };

function tokens(): Record<string, Token> {
  try { return JSON.parse(readFileSync(tokensFile(), "utf8")); } catch { return {}; }
}
function saveToken(name: string, t: Token): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(tokensFile(), JSON.stringify({ ...tokens(), [name]: t }, null, 2));
}

async function call(url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const d: any = await r.json().catch(() => ({}));
  const err = d.error && typeof d.error === "object" ? d.error : null;
  if (!r.ok || (err && err.code && err.code !== "ok")) throw new Error(`${new URL(url).host}: ${err?.message ?? d.error_description ?? d.message ?? r.status}`);
  return d;
}

// ---------- TikTok (Login Kit for desktop: PKCE, localhost redirect) ----------

const pkce = new Map<string, string>(); // state -> code verifier

export function tiktokStatus() {
  return { configured: Boolean(apiKey("TIKTOK_CLIENT_KEY") && apiKey("TIKTOK_CLIENT_SECRET")), connected: Boolean(tokens().tiktok?.access_token) };
}

export function tiktokAuthUrl(redirectUri: string): string {
  const key = apiKey("TIKTOK_CLIENT_KEY");
  if (!key) throw new Error("TIKTOK_CLIENT_KEY is missing in ~/.adam-studio/.env");
  const state = randomBytes(12).toString("hex");
  const verifier = randomBytes(48).toString("base64url");
  pkce.set(state, verifier);
  // TikTok's desktop flow takes the SHA-256 of the verifier in hex.
  const challenge = createHash("sha256").update(verifier).digest("hex");
  return `https://www.tiktok.com/v2/auth/authorize/?client_key=${key}&scope=user.info.basic,user.info.stats,video.list&response_type=code`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
}

async function tiktokToken(body: Record<string, string>): Promise<void> {
  const d = await call("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: apiKey("TIKTOK_CLIENT_KEY") ?? "", client_secret: apiKey("TIKTOK_CLIENT_SECRET") ?? "", ...body }),
  });
  saveToken("tiktok", { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + d.expires_in * 1000, open_id: d.open_id });
}

export async function tiktokExchange(code: string, state: string, redirectUri: string): Promise<void> {
  const verifier = pkce.get(state);
  if (!verifier) throw new Error("unknown sign-in attempt: connect TikTok again");
  pkce.delete(state);
  await tiktokToken({ code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: verifier });
}

async function tiktokAccess(): Promise<string> {
  const t = tokens().tiktok;
  if (!t) throw new Error("TikTok is not connected: connect it from the Insights page of the panel");
  if (t.expires_at && t.expires_at < Date.now() + 60_000) {
    if (!t.refresh_token) throw new Error("the TikTok session expired: connect again");
    await tiktokToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    return tokens().tiktok!.access_token;
  }
  return t.access_token;
}

export async function tiktokVideos(max = 200): Promise<Video[]> {
  const auth = { Authorization: `Bearer ${await tiktokAccess()}`, "Content-Type": "application/json" };
  const fields = "id,title,video_description,duration,cover_image_url,share_url,create_time,view_count,like_count,comment_count,share_count";
  const out: Video[] = [];
  let cursor: number | undefined;
  for (;;) {
    const d = await call(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, { method: "POST", headers: auth, body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) });
    for (const v of d.data?.videos ?? []) {
      out.push({
        platform: "tiktok", id: String(v.id), caption: v.video_description || v.title || "", url: v.share_url ?? "", cover: v.cover_image_url ?? "",
        publishedAt: new Date((v.create_time ?? 0) * 1000).toISOString(), durationMs: v.duration ? v.duration * 1000 : undefined,
        views: v.view_count ?? 0, likes: v.like_count ?? 0, comments: v.comment_count ?? 0, shares: v.share_count ?? 0, saves: 0,
      });
    }
    if (!d.data?.has_more || out.length >= max) return out;
    cursor = d.data.cursor;
  }
}

// ---------- Instagram (Instagram API with Instagram Login; token pasted from the Meta app dashboard) ----------

const IG = "https://graph.instagram.com";

export function instagramStatus() {
  return { configured: Boolean(apiKey("INSTAGRAM_ACCESS_TOKEN") || tokens().instagram?.access_token), connected: Boolean(apiKey("INSTAGRAM_ACCESS_TOKEN") || tokens().instagram?.access_token) };
}

/** The saved token, refreshed (60 more days) once it is more than a day old; the .env token seeds it. */
async function instagramAccess(): Promise<string> {
  const saved = tokens().instagram;
  const token = saved?.access_token ?? apiKey("INSTAGRAM_ACCESS_TOKEN");
  if (!token) throw new Error("Instagram is not connected: put INSTAGRAM_ACCESS_TOKEN (Meta app dashboard, Instagram API setup, Generate token) in ~/.adam-studio/.env");
  const age = saved?.expires_at ? saved.expires_at - Date.now() : 0;
  if (!saved || age < 59 * 24 * 3600 * 1000) {
    try {
      const d = await call(`${IG}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
      saveToken("instagram", { access_token: d.access_token, expires_at: Date.now() + d.expires_in * 1000 });
      return d.access_token;
    } catch { return token; }
  }
  return token;
}

async function igInsights(id: string, token: string, reel: boolean): Promise<Record<string, number>> {
  const sets = reel
    ? ["views,reach,saved,shares,ig_reels_avg_watch_time", "views,reach,saved,shares", "reach,saved"]
    : ["views,reach,saved,shares", "reach,saved"];
  for (const metric of sets) {
    try {
      const d = await call(`${IG}/v23.0/${id}/insights?metric=${metric}&access_token=${token}`);
      return Object.fromEntries((d.data ?? []).map((m: any) => [m.name, Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0)]));
    } catch { /* metric not available for this media or account: try fewer */ }
  }
  return {};
}

export async function instagramVideos(max = 100): Promise<Video[]> {
  const token = await instagramAccess();
  const fields = "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count";
  const out: Video[] = [];
  let next: string | undefined = `${IG}/v23.0/me/media?fields=${fields}&limit=50&access_token=${token}`;
  while (next && out.length < max) {
    const d = await call(next);
    for (const m of d.data ?? []) {
      if (m.media_type !== "VIDEO" && m.media_product_type !== "REELS") continue;
      const ins = await igInsights(m.id, token, m.media_product_type === "REELS");
      out.push({
        platform: "instagram", id: m.id, caption: m.caption ?? "", url: m.permalink, cover: m.thumbnail_url ?? "", publishedAt: m.timestamp,
        views: ins.views ?? 0, likes: m.like_count ?? 0, comments: m.comments_count ?? 0, shares: ins.shares ?? 0, saves: ins.saved ?? 0,
        reach: ins.reach, avgWatchMs: ins.ig_reels_avg_watch_time,
      });
    }
    next = d.paging?.next;
  }
  return out;
}
