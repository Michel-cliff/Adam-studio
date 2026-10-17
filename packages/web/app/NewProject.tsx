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
  const [series, setSeries] = useState("");
  const [allSeries, setAllSeries] = useState<{ name: string; error?: string }[]>([]);
  useEffect(() => { api<{ name: string; error?: string }[]>("/series").then(setAllSeries, () => {}); }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const body = { videos: picked, lang: lang === "auto" ? undefined : lang };
      const project = addTo ?? name.trim();
      const { job } = addTo
        ? await api<{ job: { id: string } }>(`/projects/${enc(addTo)}/add`, { method: "POST", body })
        : await api<{ job: { id: string } }>("/projects", { method: "POST", body: { ...body, name: project, format, series: series || undefined } });
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
          {allSeries.length > 0 && (
            <select value={series} onChange={(e) => setSeries(e.target.value)}>
              <option value="">No series</option>
              {allSeries.filter((s) => !s.error).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
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
