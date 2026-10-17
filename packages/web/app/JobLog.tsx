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
