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
  const [allSeries, setAllSeries] = useState<{ name: string; error?: string }[]>([]);
  const [series, setSeries] = useState("");
  useEffect(() => { api<{ name: string; error?: string }[]>("/series").then((s) => { setAllSeries(s); setSeries(s.find((x) => !x.error)?.name ?? ""); }, () => {}); }, []);
  const [passNote, setPassNote] = useState("");
  const runFirstPass = async () => {
    try {
      const r = await api<{ summary: { fillers: number; retakes: unknown[]; captions: number; proposals: string[]; skipped: string[] } }>(`/projects/${enc(name)}/edit`, { method: "POST", body: { op: "first_pass" } });
      const s = r.summary;
      setPassNote(`First pass: ${s.fillers} fillers, ${s.retakes.length} failed takes, ${s.captions} captions. Proposals: ${s.proposals.join(", ") || "none"}${s.skipped.length ? ` (skipped: ${s.skipped.join("; ")})` : ""}. For the creative steps (structure, hook, visuals, sound, look), ask Claude Code: "first pass on ${name}".`);
      load();
    } catch (e) { setError((e as Error).message); }
  };
  const applySeries = async () => {
    try { await api(`/projects/${enc(name)}/edit`, { method: "POST", body: { op: "apply_series", series } }); load(); } catch (e) { setError((e as Error).message); }
  };
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
        <div className="row"><a className="button" href={`#/p/${enc(name)}/edit`}>Open editor</a>
        <a className="button quiet" href={`#/p/${enc(name)}/add`} style={{ background: "transparent", color: "inherit", border: "1px solid var(--line)" }}>Add rushes</a></div>
      </div>
      {error && !(jobId && error.startsWith("no project")) && <p className="error">{error}</p>}
      {view && !view.ok && <p className="error">{view.error}</p>}
      <section>
        <div className="row">
          <button disabled={busy} onClick={runFirstPass}>First pass</button>
          <button disabled={busy} onClick={() => run({ action: "analyze", options: {} })}>Analyze</button>
          <button disabled={busy} onClick={() => run({ action: "render", options: {} })}>Render</button>
          <button disabled={busy} onClick={() => run({ action: "review", options: {} })}>Review</button>
          <label className="row" style={{ gap: 6 }}><span className="muted">CapCut name</span><input value={capcutName} onChange={(e) => setCapcutName(e.target.value)} /></label>
          <button disabled={busy} onClick={() => run({ action: "capcut", options: { name: capcutName } })}>Export to CapCut</button>
          <button disabled={busy} className="quiet" onClick={() => run({ action: "studio", options: {} })}>Open Studio</button>
          {allSeries.length > 0 && (
            <span className="row" style={{ gap: 6 }}>
              <select value={series} onChange={(e) => setSeries(e.target.value)}>{allSeries.filter((s) => !s.error).map((s) => <option key={s.name}>{s.name}</option>)}</select>
              <button className="quiet" disabled={!series} onClick={applySeries}>Apply series</button>
            </span>
          )}
        </div>
      </section>
      {passNote && <p className="muted">{passNote}</p>}
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
