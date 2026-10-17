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
