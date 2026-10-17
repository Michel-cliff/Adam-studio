import { useEffect, useState } from "react";
import type { ProjectListItem } from "../server/types";
import { api } from "./api";

type Row = {
  key: string; platform: string; caption: string; url: string; cover: string; publishedAt: string; views: number; likes: number; comments: number;
  shares: number; saves: number; engagement: number; project: string | null; features: { durationS: number; cutsPerMin: number; hookS: number | null; framework: string | null } | null;
};
type Report = {
  fetchedAt: Record<string, string>; rows: Row[];
  compare: { feature: string; groups: { label: string; videos: number; medianViews: number; medianEngagement: number }[] }[];
  status: Record<string, { configured: boolean; connected: boolean }>;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function Insights() {
  const [report, setReport] = useState<Report | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => api<Report>("/insights").then(setReport, (e) => setNotes([e.message]));
  useEffect(() => { void load(); api<ProjectListItem[]>("/projects").then(setProjects); }, []);
  const refresh = async () => {
    setBusy(true);
    try { setNotes((await api<{ notes: string[] }>("/insights/refresh", { method: "POST" })).notes); await load(); } catch (e) { setNotes([(e as Error).message]); }
    setBusy(false);
  };
  const linkTo = async (video: string, project: string) => { await api("/insights/link", { method: "POST", body: { video, project: project || null } }); await load(); };
  if (!report) return null;
  const s = report.status;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Insights</h1>
        <button disabled={busy} onClick={refresh}>{busy ? "Fetching..." : "Refresh numbers"}</button>
      </div>
      <section>
        <div className="row">
          <strong>TikTok</strong>
          {s.tiktok!.connected ? <span className="ok">connected</span> : s.tiktok!.configured ? <a className="button" href="/api/tiktok/login">Connect TikTok</a>
            : <span className="muted">add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to ~/.adam-studio/.env (redirect URI: http://localhost:{location.port}/api/tiktok/callback)</span>}
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <strong>Instagram</strong>
          {s.instagram!.connected ? <span className="ok">connected</span> : <span className="muted">add INSTAGRAM_ACCESS_TOKEN (Meta app dashboard, Instagram API setup, Generate token) to ~/.adam-studio/.env</span>}
        </div>
        {Object.entries(report.fetchedAt).map(([p, at]) => <div key={p} className="muted">{p} fetched {new Date(at).toLocaleString()}</div>)}
        {notes.map((n) => <div key={n} className="muted">{n}</div>)}
      </section>
      {report.compare.length > 0 && (
        <>
          <h2>What moves with the numbers</h2>
          <section>
            <table>
              <thead><tr><th>Edit choice</th><th>Videos</th><th>Median views</th><th>Median engagement</th></tr></thead>
              <tbody>{report.compare.flatMap((c) => c.groups.map((g) => <tr key={c.feature + g.label}><td>{g.label}</td><td>{g.videos}</td><td>{g.medianViews}</td><td>{pct(g.medianEngagement)}</td></tr>))}</tbody>
            </table>
            <p className="muted">Link each video to its project below; with more linked videos these comparisons mean more.</p>
          </section>
        </>
      )}
      <h2>Videos</h2>
      {report.rows.length === 0 && <p className="muted">No videos yet: connect a platform and refresh.</p>}
      <section>
        <table>
          <thead><tr><th></th><th>Video</th><th>Views</th><th>Engagement</th><th>Likes / comments / shares / saves</th><th>Project</th></tr></thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.key}>
                <td>{r.cover ? <img src={r.cover} alt="" style={{ width: 54, borderRadius: 4 }} /> : null}</td>
                <td><a href={r.url} target="_blank" rel="noreferrer">{r.caption.slice(0, 70) || r.key}</a><div className="muted">{r.platform} · {new Date(r.publishedAt).toLocaleDateString()}</div></td>
                <td>{r.views.toLocaleString()}</td>
                <td>{pct(r.engagement)}</td>
                <td>{r.likes} / {r.comments} / {r.shares} / {r.saves}</td>
                <td>
                  <select value={r.project ?? ""} onChange={(e) => linkTo(r.key, e.target.value)}>
                    <option value="">not linked</option>
                    {projects.map((p) => <option key={p.name}>{p.name}</option>)}
                  </select>
                  {r.features && <div className="muted">{r.features.durationS} s · {r.features.cutsPerMin} cuts/min{r.features.hookS !== null ? ` · hook ${r.features.hookS} s` : ""}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
