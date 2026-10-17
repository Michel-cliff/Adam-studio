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
