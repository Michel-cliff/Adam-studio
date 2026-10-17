import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inspirationRoot } from "./local";
import { apiKey } from "./online";

/**
 * Pinterest through its official API v5 (no scraping): the creator's own boards and pins. A board sync copies its
 * pin images into the Inspiration folder (Pinterest/<board>/) with the pin's title, description and link as notes.
 * Credentials: PINTEREST_APP_ID and PINTEREST_APP_SECRET (OAuth from the panel), or PINTEREST_ACCESS_TOKEN (a token
 * generated in the Pinterest developer console), in ~/.adam-studio/.env.
 */
const API = "https://api.pinterest.com/v5";
const TOKENS = join(homedir(), ".adam-studio", "tokens.json");
export const PINTEREST_SCOPES = "boards:read,pins:read,user_accounts:read";

type Token = { access_token: string; refresh_token?: string; expires_at?: number };

function readTokens(): Record<string, Token> {
  try { return JSON.parse(readFileSync(TOKENS, "utf8")); } catch { return {}; }
}

function saveToken(t: Token): void {
  mkdirSync(join(homedir(), ".adam-studio"), { recursive: true });
  writeFileSync(TOKENS, JSON.stringify({ ...readTokens(), pinterest: t }, null, 2));
}

export function pinterestStatus(): { configured: boolean; connected: boolean } {
  return {
    configured: Boolean(apiKey("PINTEREST_APP_ID") && apiKey("PINTEREST_APP_SECRET")) || Boolean(apiKey("PINTEREST_ACCESS_TOKEN")),
    connected: Boolean(apiKey("PINTEREST_ACCESS_TOKEN") || readTokens().pinterest?.access_token),
  };
}

export function pinterestAuthUrl(redirectUri: string, state: string): string {
  const id = apiKey("PINTEREST_APP_ID");
  if (!id) throw new Error("PINTEREST_APP_ID is missing in ~/.adam-studio/.env");
  return `https://www.pinterest.com/oauth/?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${PINTEREST_SCOPES}&state=${state}`;
}

async function tokenRequest(body: Record<string, string>): Promise<void> {
  const id = apiKey("PINTEREST_APP_ID");
  const secret = apiKey("PINTEREST_APP_SECRET");
  if (!id || !secret) throw new Error("PINTEREST_APP_ID and PINTEREST_APP_SECRET are needed in ~/.adam-studio/.env");
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const d: any = await r.json();
  if (!r.ok) throw new Error(`Pinterest refused the token request: ${d.message ?? r.status}`);
  saveToken({ access_token: d.access_token, refresh_token: d.refresh_token ?? readTokens().pinterest?.refresh_token, expires_at: Date.now() + (d.expires_in ?? 2592000) * 1000 });
}

export function pinterestExchange(code: string, redirectUri: string): Promise<void> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

async function accessToken(): Promise<string> {
  const direct = apiKey("PINTEREST_ACCESS_TOKEN");
  if (direct) return direct;
  const t = readTokens().pinterest;
  if (!t) throw new Error("Pinterest is not connected: connect it from the Library page of the panel");
  if (t.expires_at && t.expires_at < Date.now() + 60_000 && t.refresh_token) {
    await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    return readTokens().pinterest!.access_token;
  }
  return t.access_token;
}

async function get(path: string): Promise<any> {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(20000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Pinterest ${path}: ${d.message ?? r.status}`);
  return d;
}

async function all(path: string, max = 500): Promise<any[]> {
  const out: any[] = [];
  let bookmark: string | undefined;
  do {
    const d = await get(`${path}${path.includes("?") ? "&" : "?"}page_size=100${bookmark ? `&bookmark=${bookmark}` : ""}`);
    out.push(...(d.items ?? []));
    bookmark = d.bookmark ?? undefined;
  } while (bookmark && out.length < max);
  return out;
}

export async function pinterestBoards(): Promise<{ id: string; name: string; pins: number; description: string }[]> {
  return (await all("/boards")).map((b) => ({ id: b.id, name: b.name, pins: b.pin_count ?? 0, description: b.description ?? "" }));
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 80) || "board";

/** Copies the board's pin images (new ones only) into Inspiration/Pinterest/<board>/ with their notes. */
export async function syncPinterestBoard(boardId: string, root = inspirationRoot()): Promise<{ folder: string; added: number; total: number }> {
  const board = await get(`/boards/${encodeURIComponent(boardId)}`);
  const folder = join(root, "Pinterest", safe(board.name));
  mkdirSync(folder, { recursive: true });
  const pins = await all(`/boards/${encodeURIComponent(boardId)}/pins`);
  let added = 0;
  for (const pin of pins) {
    const images = pin.media?.images ?? {};
    const url: string | undefined = (images.originals ?? images["1200x"] ?? images["600x"] ?? Object.values(images)[0] as any)?.url;
    if (!url) continue;
    const file = join(folder, `${pin.id}.jpg`);
    if (existsSync(file)) continue;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) continue;
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const notes = [pin.title, pin.description, pin.alt_text, pin.link ? `link: ${pin.link}` : "", `pin: https://www.pinterest.com/pin/${pin.id}/`,
      pin.media?.media_type === "video" ? "video pin (cover image)" : ""].filter(Boolean).join("\n");
    writeFileSync(`${file}.txt`, `${notes}\n`);
    added++;
  }
  return { folder, added, total: pins.length };
}
