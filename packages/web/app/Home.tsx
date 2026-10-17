import { useEffect, useState } from "react";
import type { ProjectListItem } from "../server/types";
import { api, enc } from "./api";

type Item = ProjectListItem & { steps?: Record<string, string> };

export function Home() {
  const [projects, setProjects] = useState<Item[] | null>(null);
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [editRoot, setEditRoot] = useState(false);
  const load = async () => {
    try {
      const list = await api<Item[]>("/projects");
      // The workflow of each project gives the progress dots.
      const full = await Promise.all(list.map(async (p) => {
        try { const v = await api<{ workflow: { steps: Record<string, string> } | null }>(`/projects/${enc(p.name)}`); return { ...p, steps: v.workflow?.steps }; } catch { return p; }
      }));
      setProjects(full);
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    void load();
    api<{ projectsRoot: string }>("/settings").then((s) => setRoot(s.projectsRoot));
    const ev = new EventSource("/api/events");
    ev.onmessage = () => void load();
    return () => ev.close();
  }, []);
  const saveRoot = () => api("/settings", { method: "PUT", body: { projectsRoot: root } }).then(() => { setEditRoot(false); void load(); }, (e) => setError(e.message));
  return (
    <>
      <div className="hero">
        <div>
          <span className="eyebrow">Adam Studio</span>
          <h1 style={{ marginTop: 10 }}>What are we <em>cutting</em> today?</h1>
          <p>Drop your rushes, let the first pass clear the way, then choose, step by step, between the options Claude proposes.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="projects">
        <a className="pcard new" href="#/new"><span><b>+</b>New project</span></a>
        {projects?.map((p) => (
          <a key={p.name} className="pcard" href={`#/p/${enc(p.name)}`}>
            <div className="thumb" style={{ backgroundImage: `url(/api/projects/${enc(p.name)}/thumb)` }} />
            <div className="meta">
              <h3>{p.name}</h3>
              <div className="muted" style={{ fontSize: 12.5 }}>{p.format} · {p.takes} take{p.takes === 1 ? "" : "s"}{p.lastRender ? " · rendered" : ""}</div>
              {p.steps && <div className="dots">{Object.values(p.steps).map((s, i) => <i key={i} className={s} />)}</div>}
              {!p.ok && <div className="error" style={{ fontSize: 12 }}>invalid project.json</div>}
            </div>
          </a>
        ))}
      </div>
      <div className="row" style={{ marginTop: 36 }}>
        <span className="muted">Projects folder:</span>
        {editRoot ? (
          <>
            <input style={{ flex: 1, minWidth: 260 }} value={root} onChange={(e) => setRoot(e.target.value)} />
            <button className="quiet" onClick={saveRoot}>Save</button>
          </>
        ) : (
          <button className="ghost" onClick={() => setEditRoot(true)}>{root}</button>
        )}
      </div>
    </>
  );
}
