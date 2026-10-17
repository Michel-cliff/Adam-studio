import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { instagramStatus, instagramVideos, tiktokAuthUrl, tiktokExchange, tiktokStatus, tiktokVideos } from "@adam-studio/insights/src/platforms";
import { compare, features, link, mergeVideos, rank, readInsights, writeInsights, type Features } from "@adam-studio/insights/src/report";
import { safeName } from "./guards";
import { load, ToolError } from "./store";

type Ctx = {
  req: IncomingMessage; res: ServerResponse; url: URL; method: string; port: number; root: string;
  send: (status: number, body: unknown) => void; body: () => Promise<Record<string, any>>;
};

/** The features of a project's edit, or null when it cannot be read. */
export function featuresIn(root: string): (project: string) => Features | null {
  return (project) => {
    if (!safeName(project) || !existsSync(join(root, project, "project.json"))) return null;
    try { return features(load(join(root, project)).project); } catch { return null; }
  };
}

/** Ranked videos with their edit features, the feature comparison, and connection states. */
export function insightsReport(root: string) {
  const data = readInsights();
  const rows = rank(data, featuresIn(root));
  return { fetchedAt: data.fetchedAt, rows, compare: compare(rows), status: { tiktok: tiktokStatus(), instagram: instagramStatus() } };
}

/** Fetches every connected platform; a platform that fails is reported, the others still update. */
export async function refreshInsights(): Promise<string[]> {
  let data = readInsights();
  const notes: string[] = [];
  for (const [name, status, fetchAll] of [["tiktok", tiktokStatus, tiktokVideos], ["instagram", instagramStatus, instagramVideos]] as const) {
    if (!status().connected) { notes.push(`${name}: not connected`); continue; }
    try {
      const videos = await fetchAll();
      data = mergeVideos(data, name, videos);
      notes.push(`${name}: ${videos.length} videos`);
    } catch (e) { notes.push(`${name}: ${(e as Error).message}`); }
  }
  writeInsights(data);
  return notes;
}

export async function insightsRoute(c: Ctx): Promise<boolean> {
  const { url, method, send } = c;
  const path = url.pathname;
  const redirect = `http://localhost:${c.port}/api/tiktok/callback`;
  if (path === "/api/insights" && method === "GET") { send(200, insightsReport(c.root)); return true; }
  if (path === "/api/insights/refresh" && method === "POST") { send(200, { notes: await refreshInsights() }); return true; }
  if (path === "/api/insights/link" && method === "POST") {
    const b = await c.body();
    const project = b.project ? String(b.project) : null;
    if (project && !safeName(project)) throw new ToolError(`not a valid project name: "${project}"`);
    writeInsights(link(readInsights(), String(b.video), project));
    send(200, { ok: true });
    return true;
  }
  if (path === "/api/tiktok/login" && method === "GET") {
    c.res.writeHead(302, { Location: tiktokAuthUrl(redirect) }).end();
    return true;
  }
  if (path === "/api/tiktok/callback" && method === "GET") {
    const code = url.searchParams.get("code");
    if (!code) { send(400, { error: url.searchParams.get("error_description") ?? "TikTok answered without a code: connect again" }); return true; }
    await tiktokExchange(code, url.searchParams.get("state") ?? "", redirect);
    c.res.writeHead(302, { Location: "/#/insights" }).end();
    return true;
  }
  return false;
}
