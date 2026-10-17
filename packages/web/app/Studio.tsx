import { Player, type PlayerRef } from "@remotion/player";
import { Edit } from "@adam-studio/render/edit";
import type { RenderProps } from "@adam-studio/render/src/props";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JobEvent, JobView, ProjectView, ProposalView } from "../server/types";
import { api, enc, fileUrl, go, ms } from "./api";
import { JobLog } from "./JobLog";

type StepId = "rushes" | "cuts" | "structure" | "captions" | "hook" | "beats" | "visuals" | "sound" | "look" | "wrap";
const STEPS: { id: StepId; title: string; lede: string; chips: string[] }[] = [
  { id: "rushes", title: "Rushes", lede: "Your takes, analyzed. Start here: the first pass cuts the obvious and proposes captions.", chips: [] },
  { id: "cuts", title: "Cuts", lede: "What stays. Dead air, fillers and failed takes go; the strongest version of each idea stays.",
    chips: ["Tighter: cut every hesitation", "Keep it natural, only the dead air", "Cut the tangent in the middle"] },
  { id: "structure", title: "Story", lede: "The order and the arc. A framework, beats on your words, maybe a reorder.",
    chips: ["Hook, problem, solution, call to action", "Open loop: tease the ending first", "Reorder for the strongest start"] },
  { id: "captions", title: "Captions", lede: "The words on screen: rhythm, length, the word that pops.",
    chips: ["Bold two lines, one highlighted word", "Minimal, one line", "Highlight every number and name"] },
  { id: "hook", title: "Hook", lede: "The first three seconds decide everything.",
    chips: ["A bold question as the title", "Open on the most surprising sentence", "A big number in the first second"] },
  { id: "beats", title: "Beats", lede: "What marks each new idea: a word behind you, a punch-in, a flash.",
    chips: ["Big word behind me at each new idea", "Punch-in zoom on the key moments", "Flash cut between parts"] },
  { id: "visuals", title: "Visuals", lede: "Images, HUD panels, stats and animations where your words name something showable.",
    chips: ["Show what I talk about with images", "A HUD panel when I mention data", "One animated accent, nothing more"] },
  { id: "sound", title: "Sound", lede: "Whooshes, hits and silences that carry the cut.",
    chips: ["Subtle whooshes on the cuts", "A hit on the reveal", "Almost nothing, keep it clean"] },
  { id: "look", title: "Type & look", lede: "Fonts, colors, grade and the pace of the animations.",
    chips: ["Warm cinematic grade, elegant serif titles", "Clean modern sans, high contrast", "Slower, smoother animations"] },
  { id: "wrap", title: "Wrap", lede: "Render the final video and send it to CapCut.", chips: [] },
];
const WORKFLOW_STEPS = ["cuts", "structure", "captions", "hook", "beats", "visuals", "sound", "look"];

const ACTIVITY: Record<string, string> = {
  get_project: "Reading the project", get_transcript: "Reading what you say", get_reference: "Checking the formats",
  search_assets: "Searching your Inspiration and free libraries", look_at: "Looking at a reference", import_asset: "Importing a file",
  propose: "Writing the proposal", still: "Rendering a frame to check it", list_series: "Looking at the series", insights: "Reading your numbers",
};

/** Claude's job, as a feed: what it does (from the stream-json tool calls) and what it says at the end. */
function ClaudeFeed({ job, onEnd }: { job: JobView; onEnd: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [say, setSay] = useState("");
  const [state, setState] = useState(job.state);
  useEffect(() => {
    let buf = "";
    const seen: string[] = [];
    const take = (text: string) => {
      buf += text;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        let e: any;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === "assistant") {
          for (const c of e.message?.content ?? []) {
            if (c.type === "tool_use") {
              const name = String(c.name).replace(/^mcp__adam-studio__/, "");
              const label = ACTIVITY[name];
              if (label && seen[seen.length - 1] !== label) { seen.push(label); setLines([...seen]); }
            }
          }
        }
        if (e.type === "result") {
          // Plain words only: no markdown, no internal ids; the last paragraph is the message to the creator.
          const plain = String(e.result ?? "").replace(/\*\*|`/g, "").replace(/\bask\.[\w.]+/g, "").trim();
          const last = plain.split(/\n\s*\n/).pop() ?? plain;
          setSay(last.length > 320 ? `${last.slice(0, 317)}...` : last);
        }
      }
    };
    const ev = new EventSource(`/api/jobs/${job.id}/events`);
    ev.onmessage = (m) => {
      const e = JSON.parse(m.data) as JobEvent;
      if (e.type === "output") take(e.text);
      else { setState(e.job.state); ev.close(); onEnd(); }
    };
    return () => ev.close();
  }, [job.id]);
  return (
    <div className="feed">
      <div className="who">{state === "running" ? <span className="pulse" /> : null} Claude {state === "running" ? "is working" : state === "done" ? "" : `(${state})`}</div>
      <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}{state === "running" && lines.length === 0 ? <li>Getting ready</li> : null}</ul>
      {say && <div className="say">{say}</div>}
      {state === "running" && <div style={{ marginTop: 8 }}><button className="ghost" onClick={() => api(`/jobs/${job.id}/stop`, { method: "POST" })}>Stop</button></div>}
    </div>
  );
}

function ProposalCard({ p, seen, onSee, onDecide, onMore, locked }: {
  p: ProposalView; seen: string | null; locked: string | null;
  onSee: (key: string | null) => void; onDecide: (decision: string) => void; onMore: (p: ProposalView) => void;
}) {
  const pending = p.status === "pending";
  return (
    <div className={`proposal${pending ? "" : " decided"}`}>
      <div className="row">
        <span className="eyebrow">{p.id.startsWith("auto.") ? "First pass" : p.id.startsWith("ask.") ? "Claude" : "Proposal"}</span>
        <span className="spacer" />
        {!pending && <span className="chosen">{p.status.startsWith("accepted") ? `✓ ${p.status.replace("accepted ", "Chose ")}` : p.status}</span>}
      </div>
      {p.reason && <div className="why">{p.reason}</div>}
      {p.variants.length === 0 && pending && <div className="muted">Sent back for new options{p.notes.length ? `: “${p.notes.at(-1)}”` : ""}. Ask Claude below.</div>}
      {p.variants.map((v) => (
        <div key={v.key} className={`variant${seen === v.key ? " seen" : ""}`} onClick={() => onSee(seen === v.key ? null : v.key)}>
          <div className="k">{v.key}</div>
          <div>
            <div className="label">{v.label}</div>
            <div className="what">{v.summary}</div>
          </div>
          {pending && (
            <div className="acts">
              <button onClick={(e) => { e.stopPropagation(); onDecide(v.key); }} disabled={Boolean(locked)} title={locked ?? ""}>Choose {v.key}</button>
              <button className="quiet" onClick={(e) => { e.stopPropagation(); onSee(v.key); }}>{seen === v.key ? "Watching" : "Watch"}</button>
            </div>
          )}
        </div>
      ))}
      {pending && p.variants.length > 0 && (
        <div className="row" style={{ marginTop: 4 }}>
          <button className="ghost" onClick={() => onMore(p)}>More options…</button>
          <button className="ghost" onClick={() => onDecide("reject")}>None of these</button>
        </div>
      )}
    </div>
  );
}

function Screen({ name, view, proposal, variant }: { name: string; view: ProjectView; proposal: string | null; variant: string | null }) {
  const [props, setProps] = useState<RenderProps | null>(null);
  const [base, setBase] = useState<RenderProps | null>(null);
  const [error, setError] = useState("");
  const player = useRef<PlayerRef>(null);
  const stamp = JSON.stringify(view.proposals.map((p) => [p.id, p.status, p.variants.length])) + view.durationMs;
  useEffect(() => {
    let alive = true;
    const q = proposal && variant ? `?proposal=${enc(proposal)}&variant=${variant}` : "";
    Promise.all([api<RenderProps>(`/projects/${enc(name)}/preview${q}`), q ? api<RenderProps>(`/projects/${enc(name)}/preview`) : Promise.resolve(null)])
      .then(([p, b]) => { if (alive) { setProps(p); setBase(b); setError(""); } })
      .catch((e) => { if (alive) { setProps(null); setError(e.message); } });
    return () => { alive = false; };
  }, [name, proposal, variant, stamp]);
  // Jump to what the variant adds: its first new element, caption or changed clip.
  useEffect(() => {
    if (!props || !base || !player.current) return;
    const known = new Set(base.timeline.elements.map((e) => e.id));
    const added = props.timeline.elements.filter((e) => !known.has(e.id)).map((e) => e.fromFrame);
    const caps = props.timeline.captions.length !== base.timeline.captions.length ? [props.timeline.captions[0]?.fromFrame ?? 0] : [];
    const frame = [...added, ...caps].sort((a, b) => a - b)[0] ?? 0;
    // A little into it: titles and words reveal over their first frames.
    player.current.seekTo(Math.min(props.timeline.durationFrames - 1, frame + Math.round(props.timeline.fps * 0.7)));
  }, [props, base]);
  const t = props?.timeline;
  const wide = t ? t.width > t.height : view.format === "16:9";
  return (
    <div className={`screen${wide ? " wide" : ""}`}>
      {t && props ? (
        <Player ref={player} component={Edit} inputProps={props} durationInFrames={Math.max(1, t.durationFrames)} fps={t.fps}
          compositionWidth={t.width} compositionHeight={t.height} controls style={{ width: "100%", height: "100%" }} />
      ) : (
        <div className="empty">{error ? <span className="error">{error}</span> : "Loading the preview"}</div>
      )}
    </div>
  );
}

function Rushes({ name, view, run, firstPass }: { name: string; view: ProjectView; run: (action: string, options?: Record<string, unknown>) => void; firstPass: () => void }) {
  const cacheOrder = ["edit", "proxy", "transcript", "silences"];
  return (
    <>
      <div className="cta">
        <h3>First pass</h3>
        <p className="muted" style={{ margin: "0 0 12px" }}>Cuts fillers, failed takes and dead air, and drafts the captions. You choose before anything changes.</p>
        <div className="row"><button onClick={firstPass}>Run the first pass</button><a className="button quiet" href={`#/p/${enc(name)}/add`}>Add rushes</a></div>
      </div>
      <div className="takes">
        {view.takes.map((t) => (
          <div className="take" key={t.id}>
            <div className="id">{t.id}<div className="muted" style={{ fontSize: 12, marginTop: 6, fontFamily: "var(--sans)" }}>{ms(t.durationMs)}</div></div>
            <div>
              <div>{t.firstWords || <span className="muted">no words</span>}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t.file}</div>
              <div className="cachebar">{cacheOrder.map((k) => <i key={k} className={t.cache[k]} title={`${k}: ${t.cache[k]}`} />)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}><button className="quiet" onClick={() => run("analyze")}>Analyze again</button></div>
    </>
  );
}

function Wrap({ name, view, run }: { name: string; view: ProjectView; run: (action: string, options?: Record<string, unknown>) => void }) {
  const [capcut, setCapcut] = useState(name);
  const latest = view.renders[0];
  return (
    <>
      <div className="cta">
        <h3>Final video</h3>
        <p className="muted" style={{ margin: "0 0 12px" }}>Renders the full edit as an MP4 in the project's renders folder.</p>
        <button onClick={() => run("render")}>Render the video</button>
      </div>
      <div className="cta">
        <h3>CapCut</h3>
        <p className="muted" style={{ margin: "0 0 12px" }}>Native clips, editable titles and captions; the effects CapCut cannot do come baked.</p>
        <div className="row"><input value={capcut} onChange={(e) => setCapcut(e.target.value)} style={{ flex: 1 }} /><button onClick={() => run("capcut", { name: capcut })}>Export</button></div>
      </div>
      {latest && (
        <section>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Latest render · {new Date(latest.mtime).toLocaleString()}</div>
          <video controls preload="metadata" src={fileUrl(name, latest.file, latest.mtime)} />
          <div className="row" style={{ marginTop: 10 }}><a className="button quiet" href={fileUrl(name, latest.file)} download>Download</a></div>
        </section>
      )}
    </>
  );
}

export function Studio({ name, jobId }: { name: string; jobId?: string }) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<StepId | null>(null);
  const [seen, setSeen] = useState<{ proposal: string; key: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [refill, setRefill] = useState<ProposalView | null>(null);
  const [toast, setToast] = useState("");
  const load = useCallback(() => api<ProjectView>(`/projects/${enc(name)}`).then((v) => { setView(v); setError(""); }, (e) => setError(e.message)), [name]);
  useEffect(() => {
    void load();
    const ev = new EventSource("/api/events");
    ev.onmessage = (m) => { if (JSON.parse(m.data).project === name) void load(); };
    return () => ev.close();
  }, [name]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3200); return () => clearTimeout(t); }, [toast]);
  // Open on the step the workflow is at (or the rushes before any first pass).
  useEffect(() => { if (view && step === null) setStep((view.workflow?.current as StepId) ?? "rushes"); }, [view]);

  const edit = async (body: Record<string, unknown>, done?: string) => {
    try { await api(`/projects/${enc(name)}/edit`, { method: "POST", body }); if (done) setToast(done); await load(); return true; }
    catch (e) { setError((e as Error).message); return false; }
  };
  const run = async (action: string, options: Record<string, unknown> = {}) => {
    try { const { job } = await api<{ job: JobView }>(`/projects/${enc(name)}/jobs`, { method: "POST", body: { action, options } }); go(`#/p/${enc(name)}/job/${job.id}`); await load(); }
    catch (e) { setError((e as Error).message); }
  };
  const ask = async (text: string) => {
    if (!step || step === "rushes" || step === "wrap") return;
    const full = refill ? `${text}\n\n(The creator sent proposal ${refill.id} back for more options: refill that proposal with propose, same id, new variants.)` : text;
    try { await api(`/projects/${enc(name)}/ask`, { method: "POST", body: { step, prompt: full } }); setPrompt(""); setRefill(null); await load(); }
    catch (e) { setError((e as Error).message); }
  };
  const firstPass = async () => {
    try {
      const r = await api<{ summary: { fillers: number; retakes: unknown[]; captions: number } }>(`/projects/${enc(name)}/edit`, { method: "POST", body: { op: "first_pass" } });
      setToast(`First pass: ${r.summary.fillers} fillers, ${r.summary.retakes.length} failed takes, ${r.summary.captions} captions`);
      await load();
      setStep("cuts");
    } catch (e) { setError((e as Error).message); }
  };

  const proposals = useMemo(() => (view?.proposals ?? []).filter((p) => p.step === step).sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)), [view, step]);
  const running = view?.jobs.find((j) => j.state === "running");
  const claudeJob = view?.jobs.find((j) => j.label.startsWith("Claude") && (j.state === "running" || Date.now() - (j.endedAt ?? 0) < 60_000) && j.label === `Claude: ${step}`);
  const otherJob = jobId ? view?.jobs.find((j) => j.id === jobId && !j.label.startsWith("Claude")) : running && !running.label.startsWith("Claude") ? running : undefined;
  if (!view) return <main>{error ? <p className="error">{error}</p> : <p className="muted">Opening the project</p>}</main>;
  const wf = view.workflow;
  const meta = STEPS.find((s) => s.id === step) ?? STEPS[0]!;
  const lockedWhy = step && wf && WORKFLOW_STEPS.includes(step) && wf.steps[step] === "locked" ? `Finish “${STEPS.find((s) => s.id === wf.current)?.title}” first` : null;
  const pendingHere = proposals.some((p) => p.status === "pending" && p.variants.length);
  const stateOf = (id: StepId) => (id === "rushes" ? (wf ? "done" : "open") : id === "wrap" ? (view.renders.length ? "done" : "") : wf?.steps[id] ?? "");
  const pendingCount = (id: StepId) => view.proposals.filter((p) => p.step === id && p.status === "pending" && p.variants.length).length;

  return (
    <div className="studio">
      <aside className="rail">
        <div className="title">{view.name}</div>
        <div className="sub muted">{ms(view.durationMs)} · {view.format}</div>
        {STEPS.map((s, i) => (
          <button key={s.id} className={`step ${stateOf(s.id)}${step === s.id ? " on" : ""}`} onClick={() => { setStep(s.id); setSeen(null); }}>
            <span className="n">{stateOf(s.id) === "done" ? "✓" : i}</span>{s.title}
            {pendingCount(s.id) ? <span className="badge">{pendingCount(s.id)}</span> : null}
          </button>
        ))}
        <div className="foot">
          <a href={`#/p/${enc(name)}/edit`}>Fine-tune the timeline</a>
          <a href="#/library">Library</a>
          <a href="" onClick={(e) => { e.preventDefault(); void run("studio"); }}>Open Remotion Studio</a>
        </div>
      </aside>

      <div className="stage">
        <Screen name={name} view={view} proposal={seen?.proposal ?? null} variant={seen?.key ?? null} />
        {seen && (
          <div className="tabs">
            <button onClick={() => setSeen(null)}>As it stands</button>
            {view.proposals.find((p) => p.id === seen.proposal)?.variants.map((v) => (
              <button key={v.key} className={seen.key === v.key ? "on" : ""} onClick={() => setSeen({ proposal: seen.proposal, key: v.key })}>{v.key}</button>
            ))}
          </div>
        )}
      </div>

      <aside className="side">
        <div className="scroll">
          <span className="eyebrow">Step {STEPS.indexOf(meta)} of {STEPS.length - 1}</span>
          <h2>{meta.title}</h2>
          <p className="lede">{meta.lede}</p>
          {error && <p className="error" onClick={() => setError("")}>{error}</p>}
          {otherJob && <JobLog key={otherJob.id} id={otherJob.id} onEnd={() => load()} />}
          {step === "rushes" && <Rushes name={name} view={view} run={run} firstPass={firstPass} />}
          {step === "wrap" && <Wrap name={name} view={view} run={run} />}
          {claudeJob && <ClaudeFeed key={claudeJob.id} job={claudeJob} onEnd={() => void load()} />}
          {step !== "rushes" && step !== "wrap" && (
            <>
              {lockedWhy && <p className="muted">{lockedWhy} to choose here; you can already explore.</p>}
              {proposals.length === 0 && !claudeJob && <p className="muted">Nothing proposed yet for this step. Ask Claude below, or skip it.</p>}
              {proposals.map((p) => (
                <ProposalCard key={p.id} p={p} locked={lockedWhy} seen={seen?.proposal === p.id ? seen.key : null}
                  onSee={(key) => setSeen(key ? { proposal: p.id, key } : null)}
                  onDecide={async (d) => { if (await edit({ op: "decide", proposal: p.id, decision: d }, d === "reject" ? "Proposal set aside" : `Variant ${d} applied`)) setSeen(null); }}
                  onMore={(pp) => { setRefill(pp); setPrompt(""); }} />
              ))}
              {wf && wf.current === step && !pendingHere && (
                <div className="row"><button className="quiet" onClick={() => edit({ op: "close_step" }, `${meta.title} done`).then((ok) => ok && setStep((WORKFLOW_STEPS[WORKFLOW_STEPS.indexOf(step) + 1] as StepId) ?? "wrap"))}>
                  {proposals.length ? "Step done, next" : "Skip this step"} →</button></div>
              )}
            </>
          )}
        </div>
        {step !== "rushes" && step !== "wrap" && (
          <div className="composer">
            {refill && <div className="muted" style={{ marginBottom: 8 }}>New options for “{refill.reason || refill.id}”. <button className="ghost" onClick={() => setRefill(null)}>cancel</button></div>}
            <div className="chips">{meta.chips.map((c) => <button key={c} className="chip" onClick={() => setPrompt(c)}>{c}</button>)}</div>
            <textarea value={prompt} placeholder={`Tell Claude what you want for the ${meta.title.toLowerCase()}…`} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) void ask(prompt); }} />
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>Ctrl+Enter · Claude Code, your subscription</span><span className="spacer" />
              <button className="claude" disabled={!prompt.trim() || Boolean(claudeJob && claudeJob.state === "running") || Boolean(running && running.label.startsWith("Claude"))} onClick={() => ask(prompt)}>Ask Claude</button>
            </div>
          </div>
        )}
      </aside>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
