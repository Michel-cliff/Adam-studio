import { useEffect, useState } from "react";
import type { ProjectListItem } from "../server/types";
import { api, enc } from "./api";

type Local = { path: string; rel: string; kind: string; title: string; notes: string; durationMs?: number; thumb?: string };
type Online = { source: string; kind: string; title: string; url: string; preview: string; page: string; license: string; creator: string };
const KINDS = ["", "video", "image", "audio", "font", "lottie"];
const fileUrl = (path: string) => `/api/library/file?path=${enc(path)}`;

function Preview({ kind, src }: { kind: string; src: string }) {
  if (kind === "audio") return <audio controls preload="none" src={src} style={{ width: "100%" }} />;
  if (kind === "video") return <video controls preload="metadata" src={src} style={{ maxHeight: 220 }} />;
  if (kind === "image") return <img src={src} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 6 }} />;
  return null;
}

function Pinterest() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [boards, setBoards] = useState<{ id: string; name: string; pins: number }[]>([]);
  const [note, setNote] = useState("");
  useEffect(() => { api<{ configured: boolean; connected: boolean }>("/pinterest/status").then(setStatus, () => {}); }, []);
  useEffect(() => { if (status?.connected) api<typeof boards>("/pinterest/boards").then(setBoards, (e) => setNote(e.message)); }, [status?.connected]);
  const sync = async (id: string) => {
    setNote("Syncing...");
    try { const r = await api<{ added: number; total: number; folder: string }>("/pinterest/sync", { method: "POST", body: { board: id } }); setNote(`${r.added} new pins of ${r.total} in ${r.folder}`); }
    catch (e) { setNote((e as Error).message); }
  };
  if (!status) return null;
  return (
    <section>
      <strong>Pinterest</strong>
      {!status.configured && <p className="muted">Add PINTEREST_APP_ID and PINTEREST_APP_SECRET (or PINTEREST_ACCESS_TOKEN) to ~/.adam-studio/.env, then reload. Redirect URI to register in the Pinterest app: http://localhost:{location.port}/api/pinterest/callback</p>}
      {status.configured && !status.connected && <p><a className="button" href="/api/pinterest/login">Connect Pinterest</a></p>}
      {status.connected && (
        <ul>{boards.map((b) => <li key={b.id}>{b.name} <span className="muted">{b.pins} pins</span> <button className="quiet" onClick={() => sync(b.id)}>Sync to Inspiration</button></li>)}</ul>
      )}
      {note && <p className="muted">{note}</p>}
    </section>
  );
}

export function Library() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [online, setOnline] = useState(false);
  const [result, setResult] = useState<{ root: string; local: Local[]; online: Online[]; notes: string[] } | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [project, setProject] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<ProjectListItem[]>("/projects").then((p) => { setProjects(p); setProject(p[0]?.name ?? ""); }); void search(); }, []);
  async function search() {
    setBusy(true);
    try { setResult(await api(`/library/search?q=${enc(q)}&kind=${kind}&online=${online && kind ? 1 : 0}`)); setMsg(""); }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }
  const add = async (source: Record<string, unknown>) => {
    try { const r = await api<{ imported: { id: string; path: string }; message?: string }>("/library/import", { method: "POST", body: { project, source } }); setMsg(r.message ?? `Added to ${project} as asset "${r.imported.id}" (${r.imported.path}).`); }
    catch (e) { setMsg((e as Error).message); }
  };
  const addBar = (source: Record<string, unknown>) => <button className="quiet" disabled={!project} onClick={() => add(source)}>Add to {project || "a project"}</button>;
  return (
    <>
      <h1>Library</h1>
      <section className="row">
        <input placeholder="Search (e.g. glitch, whoosh, neon)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} style={{ flex: 1, minWidth: 200 }} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{k || "any kind"}</option>)}</select>
        <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} /> online too</label>
        <button disabled={busy} onClick={search}>Search</button>
        <span className="muted">into</span>
        <select value={project} onChange={(e) => setProject(e.target.value)}>{projects.map((p) => <option key={p.name}>{p.name}</option>)}</select>
      </section>
      {online && !kind && <p className="muted">Pick a kind to search online.</p>}
      {msg && <p className="muted">{msg}</p>}
      {result && (
        <>
          <h2>Inspiration <span className="muted">({result.root})</span></h2>
          {result.local.length === 0 && <p className="muted">Nothing here yet. Drop videos, images, sounds, fonts or Lottie files in that folder; a .txt next to a file adds notes.</p>}
          <div className="grid">
            {result.local.map((i) => (
              <div className="card" key={i.path}>
                <Preview kind={i.kind} src={i.kind === "video" && i.thumb ? fileUrl(i.thumb) : fileUrl(i.path)} />
                <div><strong>{i.title}</strong> <span className="muted">{i.kind}{i.durationMs ? ` · ${(i.durationMs / 1000).toFixed(1)} s` : ""}</span></div>
                <div className="muted" style={{ fontSize: 13 }}>{i.rel}</div>
                {i.notes && <div style={{ fontSize: 13 }}>{i.notes.slice(0, 160)}</div>}
                {addBar({ path: i.path, kind: i.kind, title: i.title })}
              </div>
            ))}
          </div>
          {result.online.length > 0 && <h2>Online</h2>}
          {result.notes.map((n) => <p key={n} className="muted">{n}</p>)}
          <div className="grid">
            {result.online.map((i) => (
              <div className="card" key={i.url}>
                <Preview kind={i.kind === "video" ? "image" : i.kind} src={i.kind === "audio" ? i.url : i.preview} />
                <div><strong>{i.title.slice(0, 60)}</strong></div>
                <div className="muted" style={{ fontSize: 13 }}>{i.source} · {i.license} · {i.creator} · <a href={i.page} target="_blank" rel="noreferrer">source</a></div>
                {addBar({ url: i.url, kind: i.kind, title: i.title, license: i.license, creator: i.creator, page: i.page })}
              </div>
            ))}
          </div>
        </>
      )}
      <h2>Connections</h2>
      <Pinterest />
    </>
  );
}
