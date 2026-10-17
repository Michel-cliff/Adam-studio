import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative, isAbsolute } from "node:path";
import { importAsset, type ImportSource } from "@adam-studio/library/src/importer";
import { inspirationRoot, searchLocal, type LibraryKind } from "@adam-studio/library/src/local";
import { searchOnline } from "@adam-studio/library/src/online";
import { pinterestAuthUrl, pinterestBoards, pinterestExchange, pinterestStatus, syncPinterestBoard } from "@adam-studio/library/src/pinterest";
import { serveFile } from "./files";
import { safeName } from "./guards";
import { addAssetIn, ToolError } from "./store";

const KINDS = new Set(["video", "image", "audio", "font", "lottie"]);
const states = new Set<string>();

type Ctx = {
  req: IncomingMessage; res: ServerResponse; url: URL; method: string; port: number; root: string;
  send: (status: number, body: unknown) => void; body: () => Promise<Record<string, any>>;
};

function insideInspiration(path: string): boolean {
  const r = relative(inspirationRoot(), path);
  return Boolean(r) && !r.startsWith("..") && !isAbsolute(r);
}

/** Library and Pinterest routes; returns false when the path is not one of them. */
export async function libraryRoute(c: Ctx): Promise<boolean> {
  const { url, method, send } = c;
  const path = url.pathname;
  if (path === "/api/library/search" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const kind = url.searchParams.get("kind") || undefined;
    if (kind && !KINDS.has(kind)) throw new ToolError(`unknown kind "${kind}"`);
    const local = searchLocal(q, kind as LibraryKind | undefined);
    const online = url.searchParams.get("online") === "1" && q && kind ? await searchOnline(q, kind as LibraryKind) : { items: [], notes: [] };
    send(200, { root: inspirationRoot(), local, online: online.items, notes: online.notes });
    return true;
  }
  if (path === "/api/library/file" && method === "GET") {
    const file = url.searchParams.get("path") ?? "";
    if (!insideInspiration(file) || !existsSync(file)) { send(404, { error: "not in the Inspiration folder" }); return true; }
    serveFile(c.req, c.res, file);
    return true;
  }
  if (path === "/api/library/import" && method === "POST") {
    const b = await c.body();
    const project = String(b.project ?? "");
    if (!safeName(project) || !existsSync(join(c.root, project, "project.json"))) throw new ToolError(`no project "${project}"`);
    const source = (b.source ?? {}) as ImportSource;
    if (source.path && !insideInspiration(source.path)) throw new ToolError("local imports come from the Inspiration folder");
    if (source.url && !/^https:\/\//.test(source.url)) throw new ToolError("only https downloads");
    const dir = join(c.root, project);
    let imported;
    try { imported = await importAsset(dir, source, b.id || undefined); } catch (e) { throw new ToolError((e as Error).message); }
    if (imported.kind === "font") { send(200, { imported, message: `font copied to ${imported.path}: use it in the style (fonts.caption or fonts.title)` }); return true; }
    send(200, { imported, ...addAssetIn(dir, { id: imported.id, kind: imported.kind, path: imported.path }) });
    return true;
  }
  if (path === "/api/pinterest/status" && method === "GET") { send(200, pinterestStatus()); return true; }
  const redirect = `http://localhost:${c.port}/api/pinterest/callback`;
  if (path === "/api/pinterest/login" && method === "GET") {
    const state = randomBytes(12).toString("hex");
    states.add(state);
    c.res.writeHead(302, { Location: pinterestAuthUrl(redirect, state) }).end();
    return true;
  }
  if (path === "/api/pinterest/callback" && method === "GET") {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    if (!states.delete(state) || !code) { send(400, { error: "Pinterest answered without a valid state or code: connect again" }); return true; }
    await pinterestExchange(code, redirect);
    c.res.writeHead(302, { Location: "/#/library" }).end();
    return true;
  }
  if (path === "/api/pinterest/boards" && method === "GET") { send(200, await pinterestBoards()); return true; }
  if (path === "/api/pinterest/sync" && method === "POST") {
    const b = await c.body();
    send(200, await syncPinterestBoard(String(b.board ?? "")));
    return true;
  }
  return false;
}
