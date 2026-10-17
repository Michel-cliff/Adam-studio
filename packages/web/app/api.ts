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
