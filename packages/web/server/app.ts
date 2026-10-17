import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { ActionError, addCommand, buildCommand, checkVideos, newProjectCommand } from "./actions";
import { serveFile } from "./files";
import { listFolder } from "./fsbrowse";
import { hostAllowed, inside, originAllowed, safeName } from "./guards";
import { BusyError, JobManager } from "./jobs";
import { venvPython, WEB } from "./paths";
import { insightsRoute } from "./insights-routes";
import { libraryRoute } from "./library-routes";
import { mediaFile, previewData } from "./preview";
import { listProjects, projectView } from "./projects";
import { applySeriesIn, cutWordsIn, listSeries, loadRaw, patchProject, setValue, ToolError, tightenIn, undo, updateItem } from "./store";
import { projectsRoot, SETTINGS_FILE, setProjectsRoot } from "./settings";
import { watchProjects } from "./watch";

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<Record<string, any>> {
  let text = "";
  for await (const chunk of req) { text += chunk; if (text.length > 1_000_000) throw new HttpError(413, "body too large"); }
  try { const v = JSON.parse(text); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* below */ }
  throw new HttpError(400, "body must be a JSON object");
}

function sse(res: ServerResponse): (data: unknown) => void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
  res.write(": open\n\n");
  return (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function createApp(opts: { settingsFile?: string; jobs?: JobManager; capcutPython?: () => string | null; dist?: string } = {}): Server {
  const settingsFile = opts.settingsFile ?? SETTINGS_FILE;
  const jobs = opts.jobs ?? new JobManager();
  const capcutPython = opts.capcutPython ?? (() => venvPython("capcut", "ADAM_CAPCUT_PYTHON"));
  const dist = opts.dist ?? join(WEB, "dist");
  const clients = new Set<(d: unknown) => void>();
  const notify = (project: string) => { for (const c of clients) c({ type: "change", project }); };
  let unwatch = watchProjects(projectsRoot(settingsFile), notify);

  const projectDir = (raw: string): { name: string; dir: string } => {
    const name = decodeURIComponent(raw);
    if (!safeName(name)) throw new HttpError(404, "no such project");
    return { name, dir: join(projectsRoot(settingsFile), name) };
  };
  const existing = (raw: string) => {
    const p = projectDir(raw);
    if (!existsSync(join(p.dir, "project.json"))) throw new HttpError(404, `no project "${p.name}"`);
    return p;
  };
  const started = (res: ServerResponse, job: unknown) => send(res, 202, { job });

  async function route(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    let m: RegExpMatchArray | null;

    if (path === "/api/ping") return send(res, 200, { app: "adam-studio" });
    if (path.startsWith("/api/insights") || path.startsWith("/api/tiktok/")) {
      const handled = await insightsRoute({ req, res, url, method, port, root: projectsRoot(settingsFile), send: (s, b) => send(res, s, b), body: () => body(req) });
      if (handled) return;
    }
    if (path.startsWith("/api/library/") || path.startsWith("/api/pinterest/")) {
      const handled = await libraryRoute({ req, res, url, method, port, root: projectsRoot(settingsFile), send: (s, b) => send(res, s, b), body: () => body(req) });
      if (handled) return;
    }
    if (path === "/api/settings" && method === "GET") return send(res, 200, { projectsRoot: projectsRoot(settingsFile) });
    if (path === "/api/settings" && method === "PUT") {
      const b = await body(req);
      if (typeof b.projectsRoot !== "string") throw new HttpError(400, "projectsRoot must be text");
      try { setProjectsRoot(b.projectsRoot, settingsFile); } catch (e) { throw new HttpError(400, (e as Error).message); }
      unwatch();
      unwatch = watchProjects(b.projectsRoot, notify);
      return send(res, 200, { projectsRoot: b.projectsRoot });
    }
    if (path === "/api/projects" && method === "GET") return send(res, 200, listProjects(projectsRoot(settingsFile)));
    if (path === "/api/projects" && method === "POST") {
      const b = await body(req);
      const name = typeof b.name === "string" ? b.name : "";
      if (!safeName(name)) throw new HttpError(400, `not a valid project name: "${name}"`);
      const dir = join(projectsRoot(settingsFile), name);
      if (existsSync(join(dir, "project.json"))) throw new HttpError(409, `a project "${name}" already exists: add rushes to it instead`);
      return started(res, jobs.start(name, newProjectCommand(dir, checkVideos(b.videos), String(b.format ?? "9:16"), b.lang || undefined, b.series || undefined)));
    }
    if ((m = path.match(/^\/api\/projects\/([^/]+)$/)) && method === "GET") {
      const { name } = existing(m[1]!);
      const view = projectView(projectsRoot(settingsFile), name);
      return send(res, 200, { ...view, jobs: jobs.list(name) });
    }
    if ((m = path.match(/^\/api\/projects\/([^/]+)\/add$/)) && method === "POST") {
      const { name, dir } = existing(m[1]!);
      const b = await body(req);
      return started(res, jobs.start(name, addCommand(dir, checkVideos(b.videos), b.lang || undefined)));
    }
    if ((m = path.match(/^\/api\/projects\/([^/]+)\/jobs$/)) && method === "POST") {
      const { name, dir } = existing(m[1]!);
      const b = await body(req);
      const options = b.options && typeof b.options === "object" ? b.options : {};
      return started(res, jobs.start(name, buildCommand(String(b.action), dir, options, capcutPython())));
    }
    if ((m = path.match(/^\/api\/projects\/([^/]+)\/files\/(.+)$/)) && (method === "GET" || method === "HEAD")) {
      const { dir } = existing(m[1]!);
      const file = inside(dir, m[2]!.split("/").map(decodeURIComponent).join("/"));
      if (!file) throw new HttpError(404, "no such file");
      return serveFile(req, res, file);
    }
    if ((m = path.match(/^\/api\/projects\/([^/]+)\/preview$/)) && method === "GET") {
      const { name, dir } = existing(m[1]!);
      return send(res, 200, previewData(dir, name));
    }
    if ((m = path.match(/^\/api\/projects\/([^/]+)\/media\/(.+)$/)) && (method === "GET" || method === "HEAD")) {
      const { name, dir } = existing(m[1]!);
      const file = mediaFile(dir, name, m[2]!.split("/").map(decodeURIComponent).join("/"));
      if (!file) throw new HttpError(404, "no such media");
      return serveFile(req, res, file);
    }
    if ((m = path.match(/^\/api\/projects\/([^/]+)\/raw$/)) && method === "GET") {
      return send(res, 200, loadRaw(existing(m[1]!).dir));
    }
    if ((m = path.match(/^\/api\/projects\/([^/]+)\/edit$/)) && method === "POST") {
      const { dir } = existing(m[1]!);
      const b = await body(req);
      switch (b.op) {
        case "update_item": return send(res, 200, updateItem(dir, b.collection === "story" ? "story" : "elements", String(b.id), b.changes ?? {}));
        case "set_value": return send(res, 200, setValue(dir, String(b.pointer), b.remove ? undefined : b.value));
        case "patch": return send(res, 200, patchProject(dir, b.patch));
        case "cut_words": return send(res, 200, cutWordsIn(dir, Array.isArray(b.words) ? b.words.map(String) : []));
        case "tighten": return send(res, 200, tightenIn(dir, Number(b.minPauseMs ?? 600), Number(b.keepMs ?? 200)));
        case "undo": return send(res, 200, { message: undo(dir) });
        case "apply_series": return send(res, 200, applySeriesIn(dir, String(b.series)));
        default: throw new HttpError(400, `unknown edit "${b.op}"`);
      }
    }
    if ((m = path.match(/^\/api\/jobs\/([^/]+)$/)) && method === "GET") {
      const job = jobs.get(m[1]!);
      if (!job) throw new HttpError(404, "no such job");
      return send(res, 200, job);
    }
    if ((m = path.match(/^\/api\/jobs\/([^/]+)\/stop$/)) && method === "POST") {
      if (!jobs.get(m[1]!)) throw new HttpError(404, "no such job");
      return send(res, 200, { stopped: jobs.stop(m[1]!) });
    }
    if ((m = path.match(/^\/api\/jobs\/([^/]+)\/events$/)) && method === "GET") {
      const job = jobs.get(m[1]!);
      if (!job) throw new HttpError(404, "no such job");
      const push = sse(res);
      push({ type: "output", text: job.output });
      if (job.state !== "running") { push({ type: "end", job }); res.end(); return; }
      const off = jobs.subscribe(job.id, (e) => { push(e); if (e.type === "end") res.end(); });
      req.on("close", off);
      return;
    }
    if (path === "/api/series" && method === "GET") return send(res, 200, listSeries());
    if (path === "/api/fs" && method === "GET") {
      try { return send(res, 200, listFolder(url.searchParams.get("path") || undefined)); } catch (e) { throw new HttpError(400, (e as Error).message); }
    }
    if (path === "/api/events" && method === "GET") {
      const push = sse(res);
      clients.add(push);
      req.on("close", () => clients.delete(push));
      return;
    }
    if (path.startsWith("/api/")) throw new HttpError(404, "unknown route");
    if (method !== "GET" && method !== "HEAD") throw new HttpError(404, "unknown route");
    if (!existsSync(join(dist, "index.html"))) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("The page is not built yet. Run: npm run build -w packages/web");
      return;
    }
    const file = path === "/" ? join(dist, "index.html") : inside(dist, decodeURIComponent(path.slice(1)));
    return serveFile(req, res, file && existsSync(file) ? file : join(dist, "index.html"));
  }

  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    if (!hostAllowed(req.headers.host, port) || !originAllowed(req.method ?? "GET", req.headers.origin, port)) {
      send(res, 403, { error: "refused: the panel only answers itself" });
      return;
    }
    route(req, res, port).catch((e: unknown) => {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof ActionError || e instanceof ToolError) return send(res, 400, { error: e.message });
      if (e instanceof BusyError) return send(res, 409, { error: e.message });
      if (e instanceof URIError) return send(res, 404, { error: "bad path" });
      send(res, 500, { error: (e as Error).message });
    });
  });
  server.on("close", () => unwatch());
  return server;
}
