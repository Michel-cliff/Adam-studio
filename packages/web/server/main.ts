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
