# Adam Studio control panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local browser page that runs the Adam Studio commands (new, add, analyze, render, review, decide, CapCut export, Studio) with live job logs, so the creator never types a command.

**Architecture:** New workspace `packages/web`: a node:http server (`server/`) with a JSON API, Server-Sent Events and static files, which runs every action as a child process with an argument array (the existing CLI through tsx, the CapCut exporter through its venv); a React page (`app/`) built by Vite into `packages/web/dist`. The server reads project files to display them and never writes `project.json`.

**Tech Stack:** Node 24, TypeScript 7, node:http, React 19.3.1, Vite 8.3.4 + @vitejs/plugin-react 6.1.2, vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-17-adam-studio-control-panel-design.md`

## Global Constraints

- Address `http://127.0.0.1:4317`, `ADAM_UI_PORT` overrides; listen on 127.0.0.1 only.
- Projects root: saved setting in `~/.adam-studio/ui.json`, else `ADAM_PROJECTS`, else `~/AdamStudioProjects`.
- Child processes get argument arrays, never a shell string; free text goes as `--opt=value`.
- Requests with a `Host` other than `127.0.0.1:<port>` / `localhost:<port>` are refused; non-GET requests with an `Origin` other than the panel's are refused.
- One job at a time per project; last 20 jobs per project kept; Stop ends the process tree (`taskkill /pid <pid> /T /F` on Windows).
- The panel never deletes files and never overrides `.locked` or "not created by Adam Studio" CapCut refusals; `--replace` only after a confirm.
- No personal footage committed; test media are generated with ffmpeg lavfi.
- No em dash characters in texts the page shows.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Project or file names with spaces and accents (`projet démo`, `take a.mp4`): every route and argument must carry them intact (Task 5 e2e uses them).
- A `files/` path with `..` or an encoded `%2e%2e%2f` must never leave the project folder (Task 1 `inside`, Task 5 route test).
- A job started while another runs on the same project gets 409 with the running job's name, not a second process (Task 3, Task 5).
- A project folder whose `project.json` is invalid JSON still lists, with its error (Task 4).
- Stop on a job that spawned children (Remotion renders) must end the whole tree, and a stopped job reads "stopped", not "failed" (Task 3).

---

## File structure

```
packages/web/
  package.json, tsconfig.json, vite.config.ts
  server/
    paths.ts      repo paths, tsx/cli entry, venv python lookup
    types.ts      types shared with the page (JobView, ProjectView, ...)
    guards.ts     hostAllowed, originAllowed, safeName, inside
    actions.ts    ActionError, cliCommand, buildCommand, newProjectCommand, addCommand
    jobs.ts       JobManager, BusyError, hintOf
    settings.ts   projectsRoot, setProjectsRoot
    projects.ts   listProjects, projectView
    fsbrowse.ts   listFolder
    files.ts      serveFile (range support)
    watch.ts      watchProjects
    app.ts        createApp (router)
    main.ts       npm run ui entry
  app/
    index.html, main.tsx, api.ts, style.css
    Home.tsx, NewProject.tsx, Project.tsx, JobLog.tsx
  tests/unit/*.test.ts, tests/e2e/panel.test.ts
Adam Studio.cmd   (repo root)
```

---

### Task 1: Package, paths and request guards

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/server/paths.ts`, `packages/web/server/guards.ts`
- Test: `packages/web/tests/unit/guards.test.ts`

**Interfaces:**
- Produces: `REPO`, `WEB`, `TSX`, `CLI: string`; `venvPython(pkg: "analysis" | "capcut", envVar: string): string | null`; `hostAllowed(host: string | undefined, port: number): boolean`; `originAllowed(method: string, origin: string | undefined, port: number): boolean`; `safeName(name: string): boolean`; `inside(root: string, rel: string): string | null` (absolute path strictly inside root, or null).

- [ ] **Step 1: Create the package**

`packages/web/package.json`:
```json
{
  "name": "@adam-studio/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "test": "vitest run tests/unit",
    "test:e2e": "vitest run tests/e2e --testTimeout=900000 --hookTimeout=900000",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@adam-studio/model": "0.1.0",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "tsx": "^4.23.15"
  },
  "devDependencies": {
    "@types/node": "^26.6.5",
    "@types/react": "^19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "typescript": "^7.0.2",
    "vite": "8.3.4",
    "vitest": "^5.0.5"
  }
}
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2023", "DOM", "DOM.Iterable"], "types": ["node"] },
  "include": ["server", "app", "tests", "vite.config.ts"]
}
```

Run: `npm install` at the repo root.
Expected: exit 0, `node_modules/vite` present.

- [ ] **Step 2: Write the failing test**

`packages/web/tests/unit/guards.test.ts`:
```ts
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hostAllowed, inside, originAllowed, safeName } from "../../server/guards";

describe("guards", () => {
  it("accepts only the panel's own host", () => {
    expect(hostAllowed("127.0.0.1:4317", 4317)).toBe(true);
    expect(hostAllowed("localhost:4317", 4317)).toBe(true);
    expect(hostAllowed("evil.com:4317", 4317)).toBe(false);
    expect(hostAllowed("127.0.0.1:80", 4317)).toBe(false);
    expect(hostAllowed(undefined, 4317)).toBe(false);
  });

  it("refuses state changes from other origins", () => {
    expect(originAllowed("GET", "http://evil.com", 4317)).toBe(true);
    expect(originAllowed("POST", undefined, 4317)).toBe(true);
    expect(originAllowed("POST", "http://127.0.0.1:4317", 4317)).toBe(true);
    expect(originAllowed("POST", "http://localhost:4317", 4317)).toBe(true);
    expect(originAllowed("POST", "http://evil.com", 4317)).toBe(false);
    expect(originAllowed("PUT", "null", 4317)).toBe(false);
  });

  it("takes plain folder names only", () => {
    expect(safeName("projet démo")).toBe(true);
    expect(safeName("1015")).toBe(true);
    for (const bad of ["", ".", "..", "a/b", "a\\b", "c:", " x", "x ", "a*b"]) expect(safeName(bad), bad).toBe(false);
  });

  it("keeps paths inside their root", () => {
    const root = resolve("/tmp/p");
    expect(inside(root, "renders/a.mp4")).toBe(join(root, "renders", "a.mp4"));
    expect(inside(root, "../x")).toBeNull();
    expect(inside(root, "renders/../../x")).toBeNull();
    expect(inside(root, "")).toBeNull();
    expect(inside(root, resolve("/etc/passwd"))).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/guards.test.ts`
Expected: FAIL, cannot resolve `../../server/guards`.

- [ ] **Step 4: Implement**

`packages/web/server/paths.ts`:
```ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = join(WEB, "..", "..");
export const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
export const CLI = join(REPO, "packages", "render", "src", "cli.ts");

/** The python of a py/<pkg> venv, or the path in envVar, or null when neither exists. */
export function venvPython(pkg: "analysis" | "capcut", envVar: string): string | null {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  for (const p of [join(REPO, "py", pkg, ".venv", "Scripts", "python.exe"), join(REPO, "py", pkg, ".venv", "bin", "python")]) if (existsSync(p)) return p;
  return null;
}
```

`packages/web/server/guards.ts`:
```ts
import { isAbsolute, relative, resolve } from "node:path";

export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** Reads are open to any origin (they change nothing); writes only from the panel itself. */
export function originAllowed(method: string, origin: string | undefined, port: number): boolean {
  if (method === "GET" || method === "HEAD" || origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 120 && name.trim() === name && name !== "." && name !== ".." && !/[\\/:*?"<>|]/.test(name);
}

/** The absolute path of rel inside root, or null when it would leave root (or is root itself). */
export function inside(root: string, rel: string): string | null {
  if (rel === "" || isAbsolute(rel)) return null;
  const full = resolve(root, rel);
  const r = relative(resolve(root), full);
  return r === "" || r.startsWith("..") || isAbsolute(r) ? null : full;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/guards.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package-lock.json packages/web
git commit -m "feat(web): package and request guards"
```

---

### Task 2: Actions to argument arrays

**Files:**
- Create: `packages/web/server/actions.ts`
- Test: `packages/web/tests/unit/actions.test.ts`

**Interfaces:**
- Consumes: `TSX`, `CLI` from `paths.ts`.
- Produces: `class ActionError extends Error`; `type Command = { cmd: string; args: string[]; label: string }`; `cliCommand(args: string[], label: string): Command`; `buildCommand(action: string, dir: string, options: Record<string, unknown>, capcutPython: string | null): Command`; `newProjectCommand(dir: string, videos: string[], format: string, lang?: string): Command`; `addCommand(dir: string, videos: string[], lang?: string): Command`; `checkVideos(videos: unknown): string[]` (throws ActionError).

- [ ] **Step 1: Write the failing test**

`packages/web/tests/unit/actions.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActionError, addCommand, buildCommand, checkVideos, newProjectCommand } from "../../server/actions";
import { CLI, TSX } from "../../server/paths";

const dir = join(tmpdir(), "projet démo");
const cli = (c: { cmd: string; args: string[] }) => { expect(c.cmd).toBe(process.execPath); expect(c.args.slice(0, 2)).toEqual([TSX, CLI]); return c.args.slice(2); };

describe("buildCommand", () => {
  it("maps each action to the CLI", () => {
    expect(cli(buildCommand("analyze", dir, {}, null))).toEqual(["analyze", dir]);
    expect(cli(buildCommand("analyze", dir, { assets: "c01,c02", steps: "subject,plate", force: true }, null)))
      .toEqual(["analyze", dir, "--assets", "c01,c02", "--steps", "subject,plate", "--force"]);
    expect(cli(buildCommand("render", dir, { force: true }, null))).toEqual(["render", dir, "--force"]);
    expect(cli(buildCommand("review", dir, {}, null))).toEqual(["review", dir]);
    expect(cli(buildCommand("decide", dir, { proposal: "p1", decision: "B", note: "--warmer" }, null))).toEqual(["decide", dir, "p1", "B", "--note=--warmer"]);
    expect(cli(buildCommand("studio", dir, {}, null))).toEqual(["studio", dir]);
  });

  it("runs the CapCut exporter with its python", () => {
    const c = buildCommand("capcut", dir, { name: "1015 adam", force: true, replace: true }, "py.exe");
    expect(c).toEqual({ cmd: "py.exe", args: ["-m", "adam_capcut", "export", dir, "--name=1015 adam", "--force", "--replace"], label: "Export to CapCut" });
  });

  it("refuses bad options before anything runs", () => {
    expect(() => buildCommand("capcut", dir, {}, null)).toThrow(/CapCut environment is missing/);
    expect(() => buildCommand("decide", dir, { proposal: "p1", decision: "D" }, null)).toThrow(ActionError);
    expect(() => buildCommand("decide", dir, { decision: "A" }, null)).toThrow(ActionError);
    expect(() => buildCommand("analyze", dir, { steps: "subject;rm" }, null)).toThrow(ActionError);
    expect(() => buildCommand("analyze", dir, { assets: "--force" }, null)).toThrow(ActionError);
    expect(() => buildCommand("render", dir, { force: "yes" }, null)).toThrow(ActionError);
    expect(() => buildCommand("delete", dir, {}, null)).toThrow(/unknown action/);
  });
});

describe("new and add", () => {
  it("passes the videos and options", () => {
    expect(cli(newProjectCommand(dir, ["C:/a.mp4"], "9:16", "fr"))).toEqual(["new", dir, "C:/a.mp4", "--format", "9:16", "--lang", "fr"]);
    expect(cli(addCommand(dir, ["C:/b.mov"]))).toEqual(["add", dir, "C:/b.mov"]);
    expect(() => newProjectCommand(dir, ["C:/a.mp4"], "4:3")).toThrow(ActionError);
    expect(() => newProjectCommand(dir, ["C:/a.mp4"], "9:16", "french")).toThrow(ActionError);
  });

  it("accepts only existing absolute video files", () => {
    const root = mkdtempSync(join(tmpdir(), "adam actions-"));
    const v = join(root, "take a.mp4");
    writeFileSync(v, "x");
    writeFileSync(join(root, "notes.txt"), "x");
    expect(checkVideos([v])).toEqual([v]);
    expect(() => checkVideos([])).toThrow(/at least one video/);
    expect(() => checkVideos(["take a.mp4"])).toThrow(ActionError);
    expect(() => checkVideos([join(root, "missing.mp4")])).toThrow(/not found/);
    expect(() => checkVideos([join(root, "notes.txt")])).toThrow(/not a video/);
    expect(() => checkVideos("x")).toThrow(ActionError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/actions.test.ts`
Expected: FAIL, cannot resolve `../../server/actions`.

- [ ] **Step 3: Implement**

`packages/web/server/actions.ts`:
```ts
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CLI, TSX } from "./paths";

export class ActionError extends Error {}
export type Command = { cmd: string; args: string[]; label: string };
type Opts = Record<string, unknown>;

export const VIDEO_EXT = /\.(mp4|mov|mkv|m4v|avi|webm)$/i;
const ID_LIST = /^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$/;
const STEP_LIST = /^(edit|proxy|transcript|silences|subject|plate)(,(edit|proxy|transcript|silences|subject|plate))*$/;
const ID = /^[A-Za-z0-9_-]+$/;
const LANG = /^[a-z]{2,3}$/;

function text(o: Opts, key: string, pattern?: RegExp): string | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ActionError(`${key} must be text`);
  if (pattern && !pattern.test(v)) throw new ActionError(`${key} is not valid: "${v}"`);
  return v;
}

function flag(o: Opts, key: string): string[] {
  const v = o[key];
  if (v === undefined || v === false) return [];
  if (v !== true) throw new ActionError(`${key} must be true or false`);
  return [`--${key}`];
}

export function cliCommand(args: string[], label: string): Command {
  return { cmd: process.execPath, args: [TSX, CLI, ...args], label };
}

export function buildCommand(action: string, dir: string, o: Opts, capcutPython: string | null): Command {
  switch (action) {
    case "analyze": {
      const assets = text(o, "assets", ID_LIST);
      const steps = text(o, "steps", STEP_LIST);
      return cliCommand(["analyze", dir, ...(assets ? ["--assets", assets] : []), ...(steps ? ["--steps", steps] : []), ...flag(o, "force")], "Analyze");
    }
    case "render":
      return cliCommand(["render", dir, ...flag(o, "force")], "Render");
    case "review": {
      const step = text(o, "step", ID);
      return cliCommand(["review", dir, ...(step ? ["--step", step] : [])], "Review");
    }
    case "decide": {
      const proposal = text(o, "proposal", ID);
      const decision = text(o, "decision", /^(A|B|C|reject|more)$/);
      if (!proposal || !decision) throw new ActionError("decide needs a proposal and a decision (A, B, C, reject or more)");
      const note = text(o, "note");
      return cliCommand(["decide", dir, proposal, decision, ...(note ? [`--note=${note}`] : [])], `Decide ${proposal}: ${decision}`);
    }
    case "capcut": {
      if (!capcutPython) {
        throw new ActionError('The CapCut environment is missing. Create it (README, Export to CapCut):\n  python -m venv py/capcut/.venv\n  py/capcut/.venv/Scripts/python -m pip install -e "py/capcut[dev]"');
      }
      const name = text(o, "name");
      return { cmd: capcutPython, args: ["-m", "adam_capcut", "export", dir, ...(name ? [`--name=${name}`] : []), ...flag(o, "force"), ...flag(o, "replace")], label: "Export to CapCut" };
    }
    case "studio":
      return cliCommand(["studio", dir], "Studio");
    default:
      throw new ActionError(`unknown action "${action}"`);
  }
}

export function checkVideos(videos: unknown): string[] {
  if (!Array.isArray(videos) || videos.some((v) => typeof v !== "string")) throw new ActionError("videos must be a list of file paths");
  if (videos.length === 0) throw new ActionError("pick at least one video");
  for (const v of videos as string[]) {
    if (!isAbsolute(v)) throw new ActionError(`not an absolute path: ${v}`);
    if (!existsSync(v) || !statSync(v).isFile()) throw new ActionError(`video not found: ${v}`);
    if (!VIDEO_EXT.test(v)) throw new ActionError(`not a video file: ${v}`);
  }
  return videos as string[];
}

export function newProjectCommand(dir: string, videos: string[], format: string, lang?: string): Command {
  if (format !== "9:16" && format !== "16:9") throw new ActionError(`format must be 9:16 or 16:9, got "${format}"`);
  if (lang !== undefined && !LANG.test(lang)) throw new ActionError(`language is not valid: "${lang}"`);
  return cliCommand(["new", dir, ...videos, "--format", format, ...(lang ? ["--lang", lang] : [])], "New project");
}

export function addCommand(dir: string, videos: string[], lang?: string): Command {
  if (lang !== undefined && !LANG.test(lang)) throw new ActionError(`language is not valid: "${lang}"`);
  return cliCommand(["add", dir, ...videos, ...(lang ? ["--lang", lang] : [])], "Add rushes");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/actions.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/server/actions.ts packages/web/tests/unit/actions.test.ts
git commit -m "feat(web): actions as validated argument arrays"
```

---

### Task 3: Job manager

**Files:**
- Create: `packages/web/server/types.ts`, `packages/web/server/jobs.ts`
- Test: `packages/web/tests/unit/jobs.test.ts`

**Interfaces:**
- Consumes: `Command` from `actions.ts`.
- Produces (`types.ts`): `JobState = "running" | "done" | "failed" | "stopped"`; `Hint = "force" | "replace" | null`; `JobView { id; project; label; state; output; startedAt; endedAt?; hint; link? }`; `JobEvent = { type: "output"; text: string } | { type: "end"; job: JobView }`.
- Produces (`jobs.ts`): `class BusyError extends Error`; `hintOf(output: string): Hint`; `class JobManager { constructor(keep?: number); start(project: string, c: Command, onEnd?: (j: JobView) => void): JobView; get(id: string): JobView | undefined; list(project: string): JobView[]; running(project: string): JobView | undefined; subscribe(id: string, fn: (e: JobEvent) => void): () => void; stop(id: string): boolean; stopAll(): void }`.

- [ ] **Step 1: Write the failing test**

`packages/web/tests/unit/jobs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { BusyError, hintOf, JobManager } from "../../server/jobs";
import type { JobEvent, JobView } from "../../server/types";

const node = (code: string, label = "test") => ({ cmd: process.execPath, args: ["-e", code], label });
const ended = (m: JobManager, id: string) => new Promise<JobView>((res) => {
  const j = m.get(id)!;
  if (j.state !== "running") return res(j);
  m.subscribe(id, (e: JobEvent) => { if (e.type === "end") res(e.job); });
});

describe("JobManager", () => {
  it("collects output and the exit state", async () => {
    const m = new JobManager();
    const ok = await ended(m, m.start("p", node("console.log('hello'); console.error('oops')")).id);
    expect(ok.state).toBe("done");
    expect(ok.output).toContain("hello");
    expect(ok.output).toContain("oops");
    const bad = await ended(m, m.start("p", node("process.exit(3)")).id);
    expect(bad.state).toBe("failed");
  });

  it("runs one job at a time per project", async () => {
    const m = new JobManager();
    const a = m.start("p", node("setTimeout(() => {}, 5000)", "Render"));
    expect(() => m.start("p", node(""))).toThrow(BusyError);
    expect(() => m.start("p", node(""))).toThrow(/Render is running/);
    const other = m.start("q", node(""));
    await ended(m, other.id);
    m.stop(a.id);
    expect((await ended(m, a.id)).state).toBe("stopped");
  });

  it("stops the whole process tree", async () => {
    const m = new JobManager();
    const code = "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => console.log(\"child\"), 100)'], { stdio: 'inherit' }); setTimeout(() => {}, 60000)";
    const j = m.start("p", node(code));
    await new Promise((r) => setTimeout(r, 600));
    m.stop(j.id);
    const done = await ended(m, j.id);
    expect(done.state).toBe("stopped");
    const len = m.get(j.id)!.output.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(m.get(j.id)!.output.length).toBe(len);
  });

  it("streams output to subscribers and finds the Studio link", async () => {
    const m = new JobManager();
    const j = m.start("p", node("console.log('Server ready - Local: http://localhost:3001'); setTimeout(() => {}, 200)"));
    const seen: string[] = [];
    m.subscribe(j.id, (e) => { if (e.type === "output") seen.push(e.text); });
    const done = await ended(m, j.id);
    expect(seen.join("")).toContain("Server ready");
    expect(done.link).toBe("http://localhost:3001");
  });

  it("keeps the last jobs of each project", async () => {
    const m = new JobManager(2);
    for (let i = 0; i < 3; i++) await ended(m, m.start("p", node(`console.log(${i})`)).id);
    expect(m.list("p").map((j) => j.output.trim())).toEqual(["2", "1"]);
  });

  it("reports a command that cannot start", async () => {
    const m = new JobManager();
    const j = await ended(m, m.start("p", { cmd: "no-such-program-xyz", args: [], label: "x" }).id);
    expect(j.state).toBe("failed");
    expect(j.output).toMatch(/ENOENT/);
  });
});

describe("hintOf", () => {
  it("names what would let a refused job through", () => {
    expect(hintOf("ERROR proposals.pending: 1\nRefusing to render: fix the errors above, or pass --force.")).toBe("force");
    expect(hintOf("Refusing to export: fix the errors above")).toBe("force");
    expect(hintOf('CapCut project "x" has been opened in CapCut since the last export: edits made there would be lost. Pass --replace to overwrite it')).toBe("replace");
    expect(hintOf('CapCut project "x" exists and was not created by Adam Studio')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/jobs.test.ts`
Expected: FAIL, cannot resolve `../../server/jobs`.

- [ ] **Step 3: Implement**

`packages/web/server/types.ts`:
```ts
export type JobState = "running" | "done" | "failed" | "stopped";
export type Hint = "force" | "replace" | null;
export interface JobView { id: string; project: string; label: string; state: JobState; output: string; startedAt: number; endedAt?: number; hint: Hint; link?: string }
export type JobEvent = { type: "output"; text: string } | { type: "end"; job: JobView };

export type CacheState = "done" | "missing" | "on demand";
export interface TakeView { id: string; file: string; durationMs: number | null; firstWords: string; cache: Record<string, CacheState> }
export interface RenderView { file: string; size: number; mtime: number }
export interface ProposalView { id: string; step: string; status: string; reason?: string; variants: { key: string; label: string }[]; review: { sheet: string | null; clips: Record<string, string> } | null }
export interface ProjectView { name: string; ok: boolean; error?: string; format?: string; takes: TakeView[]; renders: RenderView[]; proposals: ProposalView[]; jobs: JobView[] }
export interface ProjectListItem { name: string; ok: boolean; error?: string; format?: string; takes: number; lastRender: number | null }
export interface FolderView { path: string | null; parent: string | null; folders: string[]; videos: string[] }
```

`packages/web/server/jobs.ts`:
```ts
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { Command } from "./actions";
import type { Hint, JobEvent, JobView } from "./types";

const MAX_OUTPUT = 200_000;
export class BusyError extends Error {}

export function hintOf(output: string): Hint {
  if (/Pass --replace/.test(output)) return "replace";
  if (/Refusing to (render|export)/.test(output)) return "force";
  return null;
}

export class JobManager {
  private jobs = new Map<string, JobView>();
  private procs = new Map<string, ChildProcess>();
  private listeners = new Map<string, Set<(e: JobEvent) => void>>();
  private stopping = new Set<string>();
  private seq = 0;

  constructor(private keep = 20) {}

  running(project: string): JobView | undefined {
    return [...this.jobs.values()].find((j) => j.project === project && j.state === "running");
  }

  start(project: string, c: Command, onEnd?: (j: JobView) => void): JobView {
    const busy = this.running(project);
    if (busy) throw new BusyError(`${project} is busy: ${busy.label} is running`);
    const job: JobView = { id: `j${++this.seq}`, project, label: c.label, state: "running", output: "", startedAt: Date.now(), hint: null };
    this.jobs.set(job.id, job);
    const emit = (e: JobEvent) => { for (const fn of this.listeners.get(job.id) ?? []) fn(e); };
    const add = (chunk: Buffer | string) => {
      const text = chunk.toString();
      job.output = (job.output + text).slice(-MAX_OUTPUT);
      const link = text.match(/https?:\/\/localhost:\d+/);
      if (link && !job.link) job.link = link[0];
      emit({ type: "output", text });
    };
    const finish = (code: number | null) => {
      if (job.state !== "running") return;
      job.state = this.stopping.delete(job.id) ? "stopped" : code === 0 ? "done" : "failed";
      job.hint = job.state === "failed" ? hintOf(job.output) : null;
      job.endedAt = Date.now();
      this.procs.delete(job.id);
      emit({ type: "end", job: { ...job } });
      this.listeners.delete(job.id);
      this.prune(project);
      onEnd?.(job);
    };
    const child = spawn(c.cmd, c.args, { windowsHide: true, detached: process.platform !== "win32", env: { ...process.env, FORCE_COLOR: "0" } });
    this.procs.set(job.id, child);
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    child.on("error", (err) => { add(`${err.message}\n`); finish(1); });
    child.on("close", (code) => finish(code));
    return job;
  }

  get(id: string): JobView | undefined { return this.jobs.get(id); }

  /** Newest first. */
  list(project: string): JobView[] {
    return [...this.jobs.values()].filter((j) => j.project === project).reverse();
  }

  subscribe(id: string, fn: (e: JobEvent) => void): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(fn);
    this.listeners.set(id, set);
    return () => set.delete(fn);
  }

  stop(id: string): boolean {
    const child = this.procs.get(id);
    if (!child || child.pid === undefined) return false;
    this.stopping.add(id);
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
    return true;
  }

  stopAll(): void { for (const id of [...this.procs.keys()]) this.stop(id); }

  private prune(project: string): void {
    const ended = [...this.jobs.values()].filter((j) => j.project === project && j.state !== "running");
    for (const j of ended.slice(0, Math.max(0, ended.length - this.keep))) this.jobs.delete(j.id);
  }
}
```

(`detached` off Windows makes the child lead a process group, so `process.kill(-pid)` reaches the whole tree.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/jobs.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/server/types.ts packages/web/server/jobs.ts packages/web/tests/unit/jobs.test.ts
git commit -m "feat(web): job manager with live output and tree stop"
```

---

### Task 4: Read side (settings, projects, folders, files)

**Files:**
- Create: `packages/web/server/settings.ts`, `packages/web/server/projects.ts`, `packages/web/server/fsbrowse.ts`, `packages/web/server/files.ts`
- Test: `packages/web/tests/unit/read.test.ts`

**Interfaces:**
- Consumes: types from `types.ts`, `VIDEO_EXT` from `actions.ts`, `parseProject` from `@adam-studio/model`.
- Produces: `projectsRoot(file?: string): string`; `setProjectsRoot(root: string, file?: string): void`; `listProjects(root: string): ProjectListItem[]`; `projectView(root: string, name: string): Omit<ProjectView, "jobs"> | null` (null when no `project.json`); `listFolder(path?: string): FolderView`; `serveFile(req: IncomingMessage, res: ServerResponse, file: string): void`.

- [ ] **Step 1: Write the failing test**

`packages/web/tests/unit/read.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serveFile } from "../../server/files";
import { listFolder } from "../../server/fsbrowse";
import { listProjects, projectView } from "../../server/projects";
import { projectsRoot, setProjectsRoot } from "../../server/settings";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "adam web-"));
  const dir = join(root, "projet démo");
  mkdirSync(join(dir, "cache", "c01"), { recursive: true });
  mkdirSync(join(dir, "renders", "review", "p1"), { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({
    version: 1, name: "projet démo", canvas: { format: "9:16", fps: 30 }, style: "style.json",
    assets: [{ id: "c01", kind: "video", path: "C:/rushes/take a.mp4" }],
    transcript: { words: { c01: [{ text: "Bonjour", startMs: 0, endMs: 300 }, { text: "tout", startMs: 300, endMs: 500 }, { text: "le", startMs: 500, endMs: 600 }, { text: "monde", startMs: 600, endMs: 900 }] } },
    story: [],
    proposals: [{ id: "p1", step: "hook", status: "pending", reason: "stronger start", variants: [{ key: "A", label: "zoom", patch: [] }, { key: "B", label: "cut", patch: [] }] }],
  }));
  for (const f of ["edit.mp4", "proxy.mp4", "transcript.json"]) writeFileSync(join(dir, "cache", "c01", f), "x");
  writeFileSync(join(dir, "cache", "c01", "probe.json"), JSON.stringify({ durationMs: 2000 }));
  writeFileSync(join(dir, "renders", "demo.mp4"), "0123456789");
  writeFileSync(join(dir, "renders", "review", "p1", "index.json"), JSON.stringify({ proposal: "p1", variants: [{ key: "A", preview: "A.mp4" }, { key: "B", preview: "B.mp4" }] }));
  writeFileSync(join(dir, "renders", "review", "p1", "sheet.jpg"), "x");
  mkdirSync(join(root, "broken"));
  writeFileSync(join(root, "broken", "project.json"), "{ not json");
  mkdirSync(join(root, "not a project"));
  return root;
}

describe("settings", () => {
  it("saves the projects root and falls back to the default", () => {
    const file = join(mkdtempSync(join(tmpdir(), "adam set-")), "sub", "ui.json");
    expect(projectsRoot(file)).toBeTruthy();
    setProjectsRoot("C:/Videos/Projects", file);
    expect(projectsRoot(file)).toBe("C:/Videos/Projects");
    expect(() => setProjectsRoot("relative/dir", file)).toThrow(/absolute/);
  });
});

describe("projects", () => {
  it("lists project folders, broken ones with their error", () => {
    const list = listProjects(fixture());
    expect(list.map((p) => p.name)).toEqual(["broken", "projet démo"]);
    expect(list[0]!.ok).toBe(false);
    expect(list[0]!.error).toBeTruthy();
    expect(list[1]).toMatchObject({ ok: true, format: "9:16", takes: 1 });
    expect(list[1]!.lastRender).toBeTypeOf("number");
  });

  it("summarises takes, cache, renders and review", () => {
    const root = fixture();
    const v = projectView(root, "projet démo")!;
    expect(v.takes).toEqual([{ id: "c01", file: "take a.mp4", durationMs: 2000, firstWords: "Bonjour tout le monde",
      cache: { edit: "done", proxy: "done", transcript: "done", silences: "missing", subject: "on demand", plate: "on demand" } }]);
    expect(v.renders.map((r) => r.file)).toEqual(["renders/demo.mp4"]);
    expect(v.proposals[0]).toMatchObject({ id: "p1", status: "pending", variants: [{ key: "A", label: "zoom" }, { key: "B", label: "cut" }],
      review: { sheet: "renders/review/p1/sheet.jpg", clips: { A: "renders/review/p1/A.mp4", B: "renders/review/p1/B.mp4" } } });
    expect(projectView(root, "not a project")).toBeNull();
    expect(projectView(root, "broken")!.ok).toBe(false);
  });
});

describe("listFolder", () => {
  it("lists folders and videos only", () => {
    const root = mkdtempSync(join(tmpdir(), "adam fs-"));
    mkdirSync(join(root, "rushes"));
    mkdirSync(join(root, ".hidden"));
    for (const f of ["take a.mp4", "b.MOV", "notes.txt"]) writeFileSync(join(root, f), "x");
    const v = listFolder(root);
    expect(v.folders).toEqual([join(root, "rushes")]);
    expect(v.videos).toEqual([join(root, "b.MOV"), join(root, "take a.mp4")]);
    expect(v.parent).toBeTruthy();
    expect(listFolder().folders.length).toBeGreaterThan(0);
  });
});

describe("serveFile", () => {
  it("serves byte ranges", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "adam file-")), "v.mp4");
    writeFileSync(file, "0123456789");
    const server = createServer((req, res) => serveFile(req, res, file)).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    const get = (range?: string) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((res) => {
      request({ port, host: "127.0.0.1", path: "/", headers: range ? { range } : {} }, (r) => {
        let body = ""; r.on("data", (c) => (body += c)); r.on("end", () => res({ status: r.statusCode!, body, headers: r.headers }));
      }).end();
    });
    expect(await get()).toMatchObject({ status: 200, body: "0123456789" });
    const part = await get("bytes=2-4");
    expect(part).toMatchObject({ status: 206, body: "234" });
    expect(part.headers["content-range"]).toBe("bytes 2-4/10");
    expect((await get("bytes=-3")).body).toBe("789");
    expect((await get("bytes=7-")).body).toBe("789");
    expect((await get("bytes=20-30")).status).toBe(416);
    expect(part.headers["content-type"]).toBe("video/mp4");
    server.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/read.test.ts`
Expected: FAIL, cannot resolve `../../server/files`.

- [ ] **Step 3: Implement**

`packages/web/server/settings.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export const SETTINGS_FILE = join(homedir(), ".adam-studio", "ui.json");

export function projectsRoot(file = SETTINGS_FILE): string {
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    if (typeof s.projectsRoot === "string" && s.projectsRoot) return s.projectsRoot;
  } catch { /* no saved setting */ }
  return process.env.ADAM_PROJECTS ?? join(homedir(), "AdamStudioProjects");
}

export function setProjectsRoot(root: string, file = SETTINGS_FILE): void {
  if (!isAbsolute(root)) throw new Error(`the projects folder must be an absolute path, got "${root}"`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ projectsRoot: root }, null, 2)}\n`);
}
```

`packages/web/server/projects.ts`:
```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseProject } from "@adam-studio/model";
import type { CacheState, ProjectListItem, ProjectView, ProposalView, RenderView, TakeView } from "./types";

type Raw = Record<string, any>;
const CHEAP = ["edit", "proxy", "transcript", "silences"] as const;
const FILES: Record<string, string> = { edit: "edit.mp4", proxy: "proxy.mp4", transcript: "transcript.json", silences: "silences.json", subject: "subject.webm", plate: "plate.png" };

function readProject(dir: string): { raw: Raw | null; error?: string } {
  let raw: Raw;
  try { raw = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")); } catch (e) { return { raw: null, error: `project.json does not parse: ${(e as Error).message}` }; }
  const parsed = parseProject(raw);
  if (!parsed.ok) return { raw, error: parsed.errors.map((e) => `${e.path}: ${e.message}`).join("\n") };
  return { raw };
}

function renders(dir: string): RenderView[] {
  const folder = join(dir, "renders");
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((f) => f.toLowerCase().endsWith(".mp4"))
    .map((f) => { const s = statSync(join(folder, f)); return { file: `renders/${f}`, size: s.size, mtime: s.mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);
}

export function listProjects(root: string): ProjectListItem[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "project.json")))
    .map((d) => {
      const dir = join(root, d.name);
      const { raw, error } = readProject(dir);
      const r = renders(dir);
      return { name: d.name, ok: !error, ...(error ? { error } : {}), format: raw?.canvas?.format, takes: Array.isArray(raw?.assets) ? raw.assets.length : 0, lastRender: r[0]?.mtime ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function take(dir: string, raw: Raw, a: Raw): TakeView {
  const cache = join(dir, "cache", a.id);
  const has = (step: string) => existsSync(join(cache, FILES[step]!));
  const state: Record<string, CacheState> = {};
  for (const s of CHEAP) state[s] = has(s) ? "done" : "missing";
  for (const s of ["subject", "plate"]) state[s] = has(s) ? "done" : "on demand";
  let durationMs: number | null = null;
  try { durationMs = JSON.parse(readFileSync(join(cache, "probe.json"), "utf8")).durationMs ?? null; } catch { /* not analyzed yet */ }
  const words: Raw[] = raw.transcript?.words?.[a.id] ?? [];
  return { id: a.id, file: basename(String(a.path)), durationMs, firstWords: words.slice(0, 12).map((w) => w.text).join(" "), cache: state };
}

function proposal(dir: string, p: Raw): ProposalView {
  const status = typeof p.status === "object" && p.status?.accepted ? `accepted ${p.status.accepted}` : String(p.status ?? "pending");
  const folder = `renders/review/${p.id}`;
  let review: ProposalView["review"] = null;
  try {
    const index = JSON.parse(readFileSync(join(dir, folder, "index.json"), "utf8"));
    review = {
      sheet: existsSync(join(dir, folder, "sheet.jpg")) ? `${folder}/sheet.jpg` : null,
      clips: Object.fromEntries((index.variants ?? []).map((v: Raw) => [v.key, `${folder}/${v.preview}`])),
    };
  } catch { /* no review rendered */ }
  return { id: p.id, step: p.step, status, ...(p.reason ? { reason: p.reason } : {}), variants: (p.variants ?? []).map((v: Raw) => ({ key: v.key, label: v.label ?? "" })), review };
}

export function projectView(root: string, name: string): Omit<ProjectView, "jobs"> | null {
  const dir = join(root, name);
  if (!existsSync(join(dir, "project.json"))) return null;
  const { raw, error } = readProject(dir);
  const assets: Raw[] = Array.isArray(raw?.assets) ? raw.assets.filter((a: Raw) => a.kind === "video") : [];
  return {
    name, ok: !error, ...(error ? { error } : {}), format: raw?.canvas?.format,
    takes: raw ? assets.map((a) => take(dir, raw, a)) : [],
    renders: renders(dir),
    proposals: Array.isArray(raw?.proposals) ? raw.proposals.map((p: Raw) => proposal(dir, p)) : [],
  };
}
```

`packages/web/server/fsbrowse.ts`:
```ts
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { VIDEO_EXT } from "./actions";
import type { FolderView } from "./types";

/** Folders and video files of path; without a path, the drives (Windows) or "/". */
export function listFolder(path?: string): FolderView {
  if (!path) {
    if (process.platform !== "win32") return listFolder("/");
    const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}:\\`).filter((d) => existsSync(d));
    return { path: null, parent: null, folders: drives, videos: [] };
  }
  const entries = readdirSync(path, { withFileTypes: true }).filter((e) => !e.name.startsWith(".") && !e.name.startsWith("$"));
  const sorted = (xs: string[]) => xs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((n) => join(path, n));
  const up = dirname(path);
  return {
    path,
    parent: up === path ? (process.platform === "win32" ? "" : null) : up,
    folders: sorted(entries.filter((e) => e.isDirectory()).map((e) => e.name)),
    videos: sorted(entries.filter((e) => e.isFile() && VIDEO_EXT.test(e.name)).map((e) => e.name)),
  };
}
```
(`parent: ""` means "back to the drives list".)

`packages/web/server/files.ts`:
```ts
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".jpg": "image/jpeg", ".png": "image/png",
  ".json": "application/json", ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
};

export function serveFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  let size: number;
  try { const s = statSync(file); if (!s.isFile()) throw new Error("not a file"); size = s.size; } catch { res.writeHead(404).end(); return; }
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  const m = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    const end = m[1] !== "" && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
    res.writeHead(206, { ...base, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...base, "Content-Length": size });
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).pipe(res);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/read.test.ts`
Expected: 5 tests PASS. If the fixture's `project.json` fails `parseProject` for a schema reason (so `ok` is false), adjust the fixture to the model's schema (see `packages/model/src/schema`), not the code.

- [ ] **Step 5: Commit**

```bash
git add packages/web/server packages/web/tests/unit/read.test.ts
git commit -m "feat(web): settings, project summaries, folder browser, ranged files"
```

---

### Task 5: HTTP app, watcher, `npm run ui`

**Files:**
- Create: `packages/web/server/watch.ts`, `packages/web/server/app.ts`, `packages/web/server/main.ts`
- Modify: `package.json` (root): add `"ui": "tsx packages/web/server/main.ts"` to scripts
- Test: `packages/web/tests/unit/app.test.ts`, `packages/web/tests/e2e/panel.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 4.
- Produces: `watchProjects(root: string, onChange: (project: string) => void): () => void`; `createApp(opts: { settingsFile?: string; jobs?: JobManager; capcutPython?: () => string | null; dist?: string }): Server`.
- API (all JSON, errors as `{ error }`): `GET /api/ping` → `{ app: "adam-studio" }`; `GET|PUT /api/settings` `{ projectsRoot }`; `GET /api/projects` → `ProjectListItem[]`; `POST /api/projects` `{ name, videos, format, lang? }` → 202 `{ job }`; `GET /api/projects/:name` → `ProjectView`; `POST /api/projects/:name/add` `{ videos, lang? }` → 202 `{ job }`; `POST /api/projects/:name/jobs` `{ action, options }` → 202 `{ job }`; `GET /api/jobs/:id`; `GET /api/jobs/:id/events` (SSE, `data: JobEvent`); `POST /api/jobs/:id/stop`; `GET /api/fs?path=` → `FolderView`; `GET /api/projects/:name/files/<path>`; `GET /api/events` (SSE, `data: { type: "change", project }`). Status codes: 400 bad input, 403 guard, 404 unknown, 409 busy or project exists.

- [ ] **Step 1: Write the failing test**

`packages/web/tests/unit/app.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { JobManager } from "../../server/jobs";
import { setProjectsRoot } from "../../server/settings";

let server: Server; let port: number; let root: string; const jobs = new JobManager();

function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; json: any; text: string }>((res) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...(data ? { "content-type": "application/json" } : {}), ...opts.headers } }, (r) => {
      let text = ""; r.on("data", (c) => (text += c)); r.on("end", () => { let json; try { json = JSON.parse(text); } catch { json = undefined; } res({ status: r.statusCode!, json, text }); });
    });
    if (data) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "adam app-"));
  const dir = join(root, "projet démo");
  mkdirSync(join(dir, "renders"), { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({ version: 1, name: "projet démo", canvas: { format: "9:16", fps: 30 }, style: "style.json", assets: [], story: [] }));
  writeFileSync(join(dir, "renders", "a b.mp4"), "0123456789");
  writeFileSync(join(root, "secret.txt"), "secret");
  const settingsFile = join(root, "ui.json");
  setProjectsRoot(root, settingsFile);
  server = createApp({ settingsFile, jobs, capcutPython: () => null, dist: join(root, "no-dist") }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { jobs.stopAll(); server.close(); });

const P = `/api/projects/${encodeURIComponent("projet démo")}`;

describe("app", () => {
  it("answers ping and lists projects", async () => {
    expect((await call("GET", "/api/ping")).json).toEqual({ app: "adam-studio" });
    expect((await call("GET", "/api/projects")).json.map((p: { name: string }) => p.name)).toEqual(["projet démo"]);
    expect((await call("GET", P)).json).toMatchObject({ name: "projet démo", ok: true, renders: [{ file: "renders/a b.mp4" }], jobs: [] });
  });

  it("refuses foreign hosts and origins", async () => {
    expect((await call("GET", "/api/projects", { headers: { host: "evil.com" } })).status).toBe(403);
    expect((await call("POST", `${P}/jobs`, { body: { action: "render" }, headers: { origin: "http://evil.com" } })).status).toBe(403);
  });

  it("serves project files and never outside the project", async () => {
    const ok = await call("GET", `${P}/files/renders/${encodeURIComponent("a b.mp4")}`);
    expect(ok).toMatchObject({ status: 200, text: "0123456789" });
    expect((await call("GET", `${P}/files/..%2Fsecret.txt`)).status).toBe(404);
    expect((await call("GET", `${P}/files/%2e%2e/secret.txt`)).status).toBe(404);
    expect((await call("GET", `/api/projects/..%2F/files/secret.txt`)).status).toBe(404);
  });

  it("validates input", async () => {
    expect((await call("GET", "/api/projects/nope")).status).toBe(404);
    expect((await call("POST", `${P}/jobs`, { body: { action: "decide", options: { decision: "Z" } } })).status).toBe(400);
    expect((await call("POST", `${P}/jobs`, { body: { action: "capcut", options: {} } })).json.error).toMatch(/CapCut environment is missing/);
    expect((await call("POST", "/api/projects", { body: { name: "a/b", videos: [], format: "9:16" } })).status).toBe(400);
    expect((await call("POST", "/api/projects", { body: { name: "projet démo", videos: [join(root, "x.mp4")], format: "9:16" } })).status).toBe(409);
    expect((await call("POST", `${P}/jobs`, { text: "x" } as never)).status).toBe(400);
  });

  it("refuses a second job on a busy project", async () => {
    const j = jobs.start("projet démo", { cmd: process.execPath, args: ["-e", "setTimeout(() => {}, 5000)"], label: "Render" });
    const r = await call("POST", `${P}/jobs`, { body: { action: "review", options: {} } });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/Render is running/);
    expect((await call("GET", `/api/jobs/${j.id}`)).json.state).toBe("running");
    expect((await call("POST", `/api/jobs/${j.id}/stop`)).status).toBe(200);
  });

  it("lists folders and keeps settings", async () => {
    expect((await call("GET", `/api/fs?path=${encodeURIComponent(root)}`)).json.folders).toEqual([join(root, "projet démo")]);
    expect((await call("GET", "/api/settings")).json).toEqual({ projectsRoot: root });
    expect((await call("PUT", "/api/settings", { body: { projectsRoot: "relative" } })).status).toBe(400);
  });

  it("says how to build the page when it is missing", async () => {
    const r = await call("GET", "/");
    expect(r.status).toBe(503);
    expect(r.text).toMatch(/npm run build -w packages\/web/);
  });
});
```

Note: the `validates input` case `{ text: "x" }` posts no body: the route must answer 400 ("body must be JSON"), not crash.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit/app.test.ts`
Expected: FAIL, cannot resolve `../../server/app`.

- [ ] **Step 3: Implement**

`packages/web/server/watch.ts`:
```ts
import { mkdirSync, watch, type FSWatcher } from "node:fs";

/** Calls onChange(project) (debounced) when a project's project.json, cache or renders change. */
export function watchProjects(root: string, onChange: (project: string) => void): () => void {
  try { mkdirSync(root, { recursive: true }); } catch { return () => {}; }
  const timers = new Map<string, NodeJS.Timeout>();
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const parts = filename.toString().split(/[\\/]/);
      const [project, top] = parts;
      if (!project || !top || !["project.json", "cache", "renders"].includes(top)) return;
      if (parts.includes(".bundle") || parts.some((p) => p.startsWith("tmp-"))) return;
      clearTimeout(timers.get(project));
      timers.set(project, setTimeout(() => { timers.delete(project); onChange(project); }, 300));
    });
  } catch { return () => {}; }
  return () => { watcher.close(); for (const t of timers.values()) clearTimeout(t); };
}
```

`packages/web/server/app.ts`:
```ts
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
import { listProjects, projectView } from "./projects";
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
      return started(res, jobs.start(name, newProjectCommand(dir, checkVideos(b.videos), String(b.format ?? "9:16"), b.lang || undefined)));
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
      if (e instanceof ActionError) return send(res, 400, { error: e.message });
      if (e instanceof BusyError) return send(res, 409, { error: e.message });
      if (e instanceof URIError) return send(res, 404, { error: "bad path" });
      send(res, 500, { error: (e as Error).message });
    });
  });
  server.on("close", () => unwatch());
  return server;
}
```

`packages/web/server/main.ts`:
```ts
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createApp } from "./app";
import { JobManager } from "./jobs";
import { WEB } from "./paths";

const port = Number(process.env.ADAM_UI_PORT ?? 4317);
const url = `http://127.0.0.1:${port}`;

function newest(dir: string): number {
  return Math.max(...readdirSync(dir, { withFileTypes: true }).map((e) => e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs));
}

function ensureBuilt(): void {
  const index = join(WEB, "dist", "index.html");
  if (existsSync(index) && statSync(index).mtimeMs >= newest(join(WEB, "app"))) return;
  console.log("Building the page...");
  const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js");
  execFileSync(process.execPath, [vite, "build"], { cwd: WEB, stdio: "inherit" });
}

function openBrowser(): void {
  if (process.env.ADAM_UI_NO_OPEN) return;
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd as string, args as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function alreadyRunning(): Promise<boolean> {
  try { return (await (await fetch(`${url}/api/ping`)).json()).app === "adam-studio"; } catch { return false; }
}

ensureBuilt();
const jobs = new JobManager();
const server = createApp({ jobs });
server.on("error", async (e: NodeJS.ErrnoException) => {
  if (e.code !== "EADDRINUSE") throw e;
  if (await alreadyRunning()) { console.log(`Adam Studio is already running: ${url}`); openBrowser(); process.exit(0); }
  console.error(`Port ${port} is taken by another program. Set ADAM_UI_PORT to a free port.`);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => { console.log(`Adam Studio: ${url} (Ctrl+C to stop)`); openBrowser(); });
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { jobs.stopAll(); process.exit(0); });
```

Add `"ui": "tsx packages/web/server/main.ts"` to the root `package.json` scripts.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx --prefix packages/web vitest run --root packages/web tests/unit`
Expected: all unit tests PASS (guards 4, actions 5, jobs 7, read 5, app 7).

- [ ] **Step 5: Write the end-to-end test**

`packages/web/tests/e2e/panel.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { venvPython } from "../../server/paths";
import { setProjectsRoot } from "../../server/settings";

const hasAnalysis = venvPython("analysis", "ADAM_ANALYSIS_PYTHON") !== null;

async function untilEnd(base: string, id: string): Promise<any> {
  const res = await fetch(`${base}/api/jobs/${id}/events`);
  const reader = res.body!.getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
    const end = text.split("\n\n").map((b) => b.replace(/^data: /, "")).find((b) => b.includes('"type":"end"'));
    if (end) { reader.cancel(); return JSON.parse(end).job; }
  }
  throw new Error(`stream closed without end:\n${text}`);
}

describe.skipIf(!hasAnalysis)("control panel", () => {
  it("creates a project from rushes through the API", async () => {
    const root = mkdtempSync(join(tmpdir(), "adam panel-"));
    const rush = join(root, "take a.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=540x960:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", rush]);
    const settingsFile = join(root, "ui.json");
    setProjectsRoot(join(root, "projects"), settingsFile);
    const server = createApp({ settingsFile, dist: join(root, "no-dist") }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const r = await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "projet démo", videos: [rush], format: "9:16", lang: "fr" }) });
      expect(r.status).toBe(202);
      const job = await untilEnd(base, (await r.json()).job.id);
      expect(job.state, job.output).toBe("done");
      const view = await (await fetch(`${base}/api/projects/${encodeURIComponent("projet démo")}`)).json();
      expect(view.ok).toBe(true);
      expect(view.takes).toHaveLength(1);
      expect(view.takes[0].cache.edit).toBe("done");
      expect(view.jobs[0].label).toBe("New project");
      expect(JSON.parse(readFileSync(join(root, "projects", "projet démo", "project.json"), "utf8")).assets[0].path).toBe(rush);
      expect(existsSync(join(root, "projects", "projet démo", "cache", "c01", "proxy.mp4"))).toBe(true);
    } finally {
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 6: Run it**

Run: `npm run test:e2e -w packages/web`
Expected: 1 test PASS (about 1 to 2 minutes, mostly Whisper).

- [ ] **Step 7: Commit**

```bash
git add package.json packages/web
git commit -m "feat(web): HTTP API, live events and npm run ui"
```

---

### Task 6: The page

**Files:**
- Create: `packages/web/vite.config.ts`, `packages/web/app/index.html`, `packages/web/app/main.tsx`, `packages/web/app/api.ts`, `packages/web/app/style.css`, `packages/web/app/Home.tsx`, `packages/web/app/NewProject.tsx`, `packages/web/app/JobLog.tsx`, `packages/web/app/Project.tsx`
- Create: `Adam Studio.cmd`
- Modify: `README.md` (Packages line and a "## Control panel" section), `.gitignore` (`packages/web/dist/`)

**Interfaces:**
- Consumes: the API of Task 5, types from `server/types.ts` (type-only imports).
- Produces: hash routes `#/`, `#/new`, `#/p/<name>`, `#/p/<name>/add`, `#/p/<name>/job/<id>`.

- [ ] **Step 1: Write the build config and shell**

`packages/web/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ root: "app", plugins: [react()], build: { outDir: "../dist", emptyOutDir: true } });
```

`packages/web/app/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Adam Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`packages/web/app/api.ts`:
```ts
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `${r.status} ${r.statusText}`);
  return data as T;
}

export const enc = encodeURIComponent;
export const fileUrl = (project: string, rel: string, v?: number) =>
  `/api/projects/${enc(project)}/files/${rel.split("/").map(enc).join("/")}${v ? `?v=${Math.round(v)}` : ""}`;
export const go = (hash: string) => { location.hash = hash; };
export const ms = (n: number | null) => (n === null ? "" : `${(n / 1000).toFixed(1)} s`);
```

`packages/web/app/main.tsx`:
```tsx
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Home } from "./Home";
import { NewProject } from "./NewProject";
import { Project } from "./Project";
import "./style.css";

function useHash(): string[] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => { const on = () => setParts(read()); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  return parts;
}

function App() {
  const [page, name, sub, id] = useHash();
  let body;
  if (page === "new") body = <NewProject />;
  else if (page === "p" && name && sub === "add") body = <NewProject addTo={name} />;
  else if (page === "p" && name) body = <Project key={name} name={name} jobId={sub === "job" ? id : undefined} />;
  else body = <Home />;
  return (
    <>
      <header><a href="#/">Adam Studio</a></header>
      <main>{body}</main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

`packages/web/app/style.css`:
```css
:root { --bg: #f6f5f2; --panel: #fff; --ink: #1d1d1b; --muted: #6b6a65; --line: #e2e0da; --accent: #c2410c; --ok: #15803d; --bad: #b91c1c; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --panel: #1f1f1d; --ink: #ecebe7; --muted: #9c9a93; --line: #34332f; --accent: #fb923c; --ok: #4ade80; --bad: #f87171; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 "Segoe UI", system-ui, sans-serif; }
header { padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--panel); }
header a { color: var(--ink); font-weight: 700; text-decoration: none; }
main { max-width: 1100px; margin: 0 auto; padding: 20px; }
h1 { font-size: 22px; margin: 0 0 16px; } h2 { font-size: 17px; margin: 24px 0 10px; }
section, .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin-bottom: 14px; }
button, .button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 7px 13px; font: inherit; cursor: pointer; text-decoration: none; display: inline-block; }
button.quiet { background: transparent; color: var(--ink); border: 1px solid var(--line); }
button:disabled { opacity: .5; cursor: default; }
input, select { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink); }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.muted { color: var(--muted); } .ok { color: var(--ok); } .bad { color: var(--bad); }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
table { width: 100%; border-collapse: collapse; } td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
pre.log { background: #111; color: #ddd; padding: 10px; border-radius: 6px; max-height: 340px; overflow: auto; white-space: pre-wrap; font: 12px/1.4 Consolas, monospace; margin: 8px 0 0; }
video, img.sheet { width: 100%; border-radius: 6px; background: #000; }
.picker li { list-style: none; padding: 2px 0; } .picker ul { padding: 0; margin: 6px 0; max-height: 320px; overflow: auto; }
.error { color: var(--bad); white-space: pre-wrap; }
@media (max-width: 600px) { main { padding: 16px; } }
```

- [ ] **Step 2: Write the pages**

`packages/web/app/Home.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { ProjectListItem } from "../server/types";
import { api, enc } from "./api";

export function Home() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const load = () => api<ProjectListItem[]>("/projects").then(setProjects, (e) => setError(e.message));
  useEffect(() => {
    load();
    api<{ projectsRoot: string }>("/settings").then((s) => setRoot(s.projectsRoot));
    const ev = new EventSource("/api/events");
    ev.onmessage = () => load();
    return () => ev.close();
  }, []);
  const saveRoot = () => api("/settings", { method: "PUT", body: { projectsRoot: root } }).then(load, (e) => setError(e.message));
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Projects</h1>
        <a className="button" href="#/new">New project</a>
      </div>
      {error && <p className="error">{error}</p>}
      {projects?.length === 0 && <p className="muted">No project yet in this folder.</p>}
      <div className="grid">
        {projects?.map((p) => (
          <a key={p.name} className="card" href={`#/p/${enc(p.name)}`} style={{ color: "inherit", textDecoration: "none" }}>
            <strong>{p.name}</strong>
            <div className="muted">{p.format} · {p.takes} take{p.takes === 1 ? "" : "s"}</div>
            <div className="muted">{p.lastRender ? `last render ${new Date(p.lastRender).toLocaleString()}` : "not rendered yet"}</div>
            {!p.ok && <div className="error">{p.error}</div>}
          </a>
        ))}
      </div>
      <h2>Projects folder</h2>
      <div className="row">
        <input style={{ flex: 1, minWidth: 240 }} value={root} onChange={(e) => setRoot(e.target.value)} />
        <button className="quiet" onClick={saveRoot}>Save</button>
      </div>
    </>
  );
}
```

`packages/web/app/NewProject.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { FolderView } from "../server/types";
import { api, enc, go } from "./api";

const LANGS = ["auto", "fr", "en", "es", "de", "it", "pt"];
const leaf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function FolderPicker({ picked, setPicked }: { picked: string[]; setPicked: (v: string[]) => void }) {
  const [view, setView] = useState<FolderView | null>(null);
  const [error, setError] = useState("");
  const open = (path?: string) => api<FolderView>(`/fs${path ? `?path=${enc(path)}` : ""}`).then((v) => { setView(v); setError(""); }, (e) => setError(e.message));
  useEffect(() => { open(localStorage.getItem("adam.lastFolder") ?? undefined).catch(() => open()); }, []);
  useEffect(() => { try { if (view?.path) localStorage.setItem("adam.lastFolder", view.path); } catch { /* private mode */ } }, [view?.path]);
  const toggle = (v: string) => setPicked(picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v]);
  return (
    <section className="picker">
      <div className="row">
        <strong>{view?.path ?? "This PC"}</strong>
        {view && view.parent !== null && <button className="quiet" onClick={() => open(view.parent || undefined)}>Up</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <ul>
        {view?.folders.map((f) => <li key={f}><a href="" onClick={(e) => { e.preventDefault(); open(f); }}>📁 {leaf(f)}</a></li>)}
        {view?.videos.map((v) => (
          <li key={v}><label><input type="checkbox" checked={picked.includes(v)} onChange={() => toggle(v)} /> {leaf(v)}</label></li>
        ))}
        {view && view.folders.length + view.videos.length === 0 && <li className="muted">No folder or video here.</li>}
      </ul>
      {view?.videos.length ? <button className="quiet" onClick={() => setPicked([...new Set([...picked, ...view.videos])])}>Pick all videos here</button> : null}
    </section>
  );
}

export function NewProject({ addTo }: { addTo?: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [format, setFormat] = useState("9:16");
  const [lang, setLang] = useState("fr");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const body = { videos: picked, lang: lang === "auto" ? undefined : lang };
      const project = addTo ?? name.trim();
      const { job } = addTo
        ? await api<{ job: { id: string } }>(`/projects/${enc(addTo)}/add`, { method: "POST", body })
        : await api<{ job: { id: string } }>("/projects", { method: "POST", body: { ...body, name: project, format } });
      go(`#/p/${enc(project)}/job/${job.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <>
      <h1>{addTo ? `Add rushes to ${addTo}` : "New project"}</h1>
      {!addTo && (
        <div className="row" style={{ marginBottom: 12 }}>
          <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={format} onChange={(e) => setFormat(e.target.value)}><option>9:16</option><option>16:9</option></select>
        </div>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <span>Language</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
      </div>
      <FolderPicker picked={picked} setPicked={setPicked} />
      {picked.length > 0 && (
        <section>
          <strong>{picked.length} video{picked.length === 1 ? "" : "s"} picked</strong>
          <ul>{picked.map((p) => <li key={p}>{p} <button className="quiet" onClick={() => setPicked(picked.filter((x) => x !== p))}>Remove</button></li>)}</ul>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      <button disabled={busy || picked.length === 0 || (!addTo && !name.trim())} onClick={submit}>{addTo ? "Add and analyze" : "Create and analyze"}</button>
    </>
  );
}
```

`packages/web/app/JobLog.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import type { JobEvent, JobView } from "../server/types";
import { api } from "./api";

export function JobLog({ id, onEnd, onRetry }: { id: string; onEnd?: (j: JobView) => void; onRetry?: (extra: Record<string, boolean>) => void }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [output, setOutput] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    setOutput("");
    api<JobView>(`/jobs/${id}`).then(setJob, () => setJob(null));
    const ev = new EventSource(`/api/jobs/${id}/events`);
    ev.onmessage = (m) => {
      const e = JSON.parse(m.data) as JobEvent;
      if (e.type === "output") setOutput((o) => o + e.text);
      else { setJob(e.job); ev.close(); onEnd?.(e.job); }
    };
    return () => ev.close();
  }, [id]);
  useEffect(() => { pre.current?.scrollTo(0, pre.current.scrollHeight); }, [output]);
  if (!job) return null;
  const tail = output.trim().split("\n").slice(-3).join("\n");
  return (
    <section>
      <div className="row">
        <strong>{job.label}</strong>
        <span className={job.state === "done" ? "ok" : job.state === "running" ? "muted" : "bad"}>{job.state}</span>
        {job.state === "running" && <button className="quiet" onClick={() => api(`/jobs/${id}/stop`, { method: "POST" })}>Stop</button>}
        {job.link && <a className="button" href={job.link} target="_blank" rel="noreferrer">Open Remotion Studio</a>}
      </div>
      {job.state === "failed" && <p className="error">{tail}</p>}
      {job.state === "failed" && job.hint === "force" && onRetry && (
        <button onClick={() => onRetry({ force: true })}>{job.label === "Export to CapCut" ? "Export anyway" : "Render anyway"}</button>
      )}
      {job.state === "failed" && job.hint === "replace" && onRetry && (
        <button onClick={() => { if (confirm("Replace the CapCut project? Edits made in CapCut since the last export will be lost.")) onRetry({ replace: true }); }}>Replace the CapCut project</button>
      )}
      <pre className="log" ref={pre}>{output}</pre>
    </section>
  );
}
```

`packages/web/app/Project.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import type { ProjectView, ProposalView } from "../server/types";
import { api, enc, fileUrl, go, ms } from "./api";
import { JobLog } from "./JobLog";

type Request = { action: string; options: Record<string, unknown> };

function Review({ project, p, run }: { project: string; p: ProposalView; run: (r: Request) => void }) {
  const [note, setNote] = useState("");
  const decide = (decision: string) => run({ action: "decide", options: { proposal: p.id, decision, note: note || undefined } });
  return (
    <section>
      <div className="row"><strong>{p.id}</strong><span className="muted">{p.step} · {p.status}</span></div>
      {p.reason && <p className="muted">{p.reason}</p>}
      {p.review?.sheet && <img className="sheet" src={fileUrl(project, p.review.sheet, Date.now() / 60000)} alt={`variants of ${p.id}`} />}
      <div className="grid">
        {p.variants.map((v) => (
          <div key={v.key}>
            <div><strong>{v.key}</strong> {v.label}</div>
            {p.review?.clips[v.key] && <video controls preload="metadata" src={fileUrl(project, p.review.clips[v.key]!)} />}
            {p.status === "pending" && <button onClick={() => decide(v.key)}>Choose {v.key}</button>}
          </div>
        ))}
      </div>
      {p.status === "pending" && (
        <div className="row" style={{ marginTop: 10 }}>
          {!p.review && <button className="quiet" onClick={() => run({ action: "review", options: {} })}>Render review</button>}
          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="quiet" onClick={() => decide("reject")}>Reject</button>
          <button className="quiet" onClick={() => decide("more")}>More</button>
        </div>
      )}
    </section>
  );
}

export function Project({ name, jobId }: { name: string; jobId?: string }) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [error, setError] = useState("");
  const [last, setLast] = useState<Request | null>(null);
  const [capcutName, setCapcutName] = useState(name);
  const [playing, setPlaying] = useState<string | null>(null);
  const load = useCallback(() => api<ProjectView>(`/projects/${enc(name)}`).then((v) => { setView(v); setError(""); }, (e) => setError(e.message)), [name]);
  useEffect(() => {
    load();
    const ev = new EventSource("/api/events");
    ev.onmessage = (m) => { if (JSON.parse(m.data).project === name) load(); };
    return () => ev.close();
  }, [name]);
  const current = jobId ?? view?.jobs.find((j) => j.state === "running")?.id;
  const busy = view?.jobs.some((j) => j.state === "running") ?? false;
  const run = async (r: Request) => {
    setLast(r); setError("");
    try { const { job } = await api<{ job: { id: string } }>(`/projects/${enc(name)}/jobs`, { method: "POST", body: r }); go(`#/p/${enc(name)}/job/${job.id}`); load(); }
    catch (e) { setError((e as Error).message); }
  };
  const retry = (extra: Record<string, boolean>) => last && run({ ...last, options: { ...last.options, ...extra } });
  const pending = view?.proposals.filter((p) => p.status === "pending") ?? [];
  const latest = playing ?? view?.renders[0]?.file ?? null;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{name}</h1>
        <a className="button quiet" href={`#/p/${enc(name)}/add`} style={{ background: "transparent", color: "inherit", border: "1px solid var(--line)" }}>Add rushes</a>
      </div>
      {error && <p className="error">{error}</p>}
      {view && !view.ok && <p className="error">{view.error}</p>}
      <section>
        <div className="row">
          <button disabled={busy} onClick={() => run({ action: "analyze", options: {} })}>Analyze</button>
          <button disabled={busy} onClick={() => run({ action: "render", options: {} })}>Render</button>
          <button disabled={busy} onClick={() => run({ action: "review", options: {} })}>Review</button>
          <input value={capcutName} onChange={(e) => setCapcutName(e.target.value)} title="CapCut project name" />
          <button disabled={busy} onClick={() => run({ action: "capcut", options: { name: capcutName } })}>Export to CapCut</button>
          <button disabled={busy} className="quiet" onClick={() => run({ action: "studio", options: {} })}>Open Studio</button>
        </div>
      </section>
      {current && <JobLog key={current} id={current} onEnd={() => load()} onRetry={last ? retry : undefined} />}
      {view && view.takes.length > 0 && (
        <>
          <h2>Takes</h2>
          <section>
            <table>
              <thead><tr><th>Take</th><th>Length</th><th>Starts with</th><th>Analysis</th></tr></thead>
              <tbody>
                {view.takes.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.id}</strong><div className="muted">{t.file}</div></td>
                    <td>{ms(t.durationMs)}</td>
                    <td>{t.firstWords || <span className="muted">no words</span>}</td>
                    <td>{Object.entries(t.cache).map(([k, s]) => <div key={k} className={s === "done" ? "ok" : s === "missing" ? "bad" : "muted"}>{k}: {s}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
      {pending.length > 0 && <h2>Review</h2>}
      {pending.map((p) => <Review key={p.id} project={name} p={p} run={run} />)}
      {view && view.renders.length > 0 && (
        <>
          <h2>Renders</h2>
          <section>
            {latest && <video key={latest} controls preload="metadata" src={fileUrl(name, latest, view.renders.find((r) => r.file === latest)?.mtime)} />}
            <ul>
              {view.renders.map((r) => (
                <li key={r.file}><a href="" onClick={(e) => { e.preventDefault(); setPlaying(r.file); }}>{r.file.replace("renders/", "")}</a> <span className="muted">{new Date(r.mtime).toLocaleString()} · {(r.size / 1e6).toFixed(1)} MB</span></li>
              ))}
            </ul>
          </section>
        </>
      )}
      {view && view.jobs.filter((j) => j.id !== current).length > 0 && (
        <>
          <h2>Earlier jobs</h2>
          <section>
            {view.jobs.filter((j) => j.id !== current).map((j) => (
              <div key={j.id}><a href={`#/p/${enc(name)}/job/${j.id}`}>{j.label}</a> <span className={j.state === "done" ? "ok" : "bad"}>{j.state}</span> <span className="muted">{new Date(j.startedAt).toLocaleTimeString()}</span></div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
```

Note: while `new` runs, `GET /api/projects/<name>` answers 404 (no `project.json` yet): the page shows the error line "no project ..." above the live job log, and `onEnd` reloads it into the full view. Make the error line read better there: in `Project`, hide `error` when it starts with `no project` and `jobId` is set.

- [ ] **Step 3: Build and typecheck**

Run: `npm run build -w packages/web && npm run typecheck -w packages/web`
Expected: Vite prints `dist/index.html` and the bundle; typecheck exit 0.

- [ ] **Step 4: Launcher, ignore, docs**

`Adam Studio.cmd` (repo root, CRLF line endings):
```bat
@echo off
cd /d "%~dp0"
call npm run ui
pause
```

Append `packages/web/dist/` to `.gitignore`.

In `README.md`, add to the Packages list `- `packages/web`: the control panel (`npm run ui`).` and, before `## Analysis`, this section:
```markdown
## Control panel

    npm run ui

or double-click `Adam Studio.cmd`. It opens `http://127.0.0.1:4317` (`ADAM_UI_PORT` changes the port) with your
projects (`~/AdamStudioProjects`, changeable on the home page): create a project from rushes on your disk, add
rushes, then Analyze, Render, Review (watch the variants and choose), Export to CapCut and Open Studio, each with its
live log and a Stop button. Edits still go through Claude; the page follows the changes to `project.json`. It only
answers your own machine.
```

- [ ] **Step 5: Check in a real Chrome**

Run `npm run ui` in the background (`ADAM_UI_NO_OPEN=1`), open `http://127.0.0.1:4317` in Chrome (chrome-devtools MCP if connected, else ask the user to look) and, on a copy of the demo project (`AdamStudioProjects/demo` copied to `AdamStudioProjects/demo panel`, never the user's CapCut projects):
- home lists the projects; the projects folder field shows the root,
- the project page shows takes with cache states, a Render job streams its log and ends `done`, the render plays,
- Review renders variants when the project has a pending proposal; Choose runs decide and the proposal leaves the list,
- Stop on a running render ends it as `stopped`,
- the folder picker opens the drives, goes into a folder, and ticks videos.
Fix what fails (each fix with a unit test where the cause is server side), then rebuild.

Expected: every point above checked; the console has no errors.

- [ ] **Step 6: Run all suites and commit**

Run: `npm test && npm run typecheck && npm run test:e2e -w packages/web`
Expected: all pass (model, render, web units; web e2e 1).

```bash
git add "Adam Studio.cmd" .gitignore README.md packages/web
git commit -m "feat(web): the control panel page, launcher and docs"
```
