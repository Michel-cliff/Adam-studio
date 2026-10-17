import { Player, type PlayerRef } from "@remotion/player";
import { Edit } from "@adam-studio/render/edit";
import type { RenderProps } from "@adam-studio/render/src/props";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, enc } from "./api";

type Raw = Record<string, any>;
type Selected = { kind: "clip" | "element" | "caption"; id: string } | null;
type Word = { id: string; text: string; startMs: number; endMs: number };
const LANE_H = 26;

function lanes<T extends { fromFrame: number; durationFrames: number }>(items: T[]): (T & { lane: number })[] {
  const ends: number[] = [];
  return [...items].sort((a, b) => a.fromFrame - b.fromFrame).map((it) => {
    let lane = ends.findIndex((e) => e <= it.fromFrame);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = it.fromFrame + it.durationFrames;
    return { ...it, lane };
  });
}

function Timeline({ props, frame, selected, select, seek }: { props: RenderProps; frame: number; selected: Selected; select: (s: Selected) => void; seek: (f: number) => void }) {
  const { timeline } = props;
  const total = Math.max(1, timeline.durationFrames);
  const pct = (f: number) => `${(f / total) * 100}%`;
  const els = lanes(timeline.elements);
  const elLanes = Math.max(1, ...els.map((e) => e.lane + 1));
  const caps = lanes(timeline.captions);
  const capLanes = Math.max(1, ...caps.map((c) => c.lane + 1));
  const row = (label: string, height: number, children: React.ReactNode) => (
    <div className="tl-row">
      <div className="tl-label">{label}</div>
      <div className="tl-track" style={{ height }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(Math.round(((e.clientX - r.left) / r.width) * total)); }}>
        {children}
        <div className="tl-head" style={{ left: pct(frame) }} />
      </div>
    </div>
  );
  const block = (kind: "clip" | "element" | "caption", id: string, from: number, dur: number, label: string, lane = 0) => (
    <div key={`${kind}-${id}`} title={label} className={`tl-block tl-${kind}${selected?.kind === kind && selected.id === id ? " sel" : ""}`}
      style={{ left: pct(from), width: pct(dur), top: lane * LANE_H + 2 }}
      onClick={(e) => { e.stopPropagation(); select({ kind, id }); seek(from); }}>{label}</div>
  );
  return (
    <section className="timeline">
      {row("Story", LANE_H + 4, timeline.clips.map((c) => block("clip", c.id, c.fromFrame, c.durationFrames, `${c.id} · ${c.asset}`)))}
      {row("Elements", elLanes * LANE_H + 4, els.map((e) => block("element", e.id, e.fromFrame, e.durationFrames, `${e.kind} ${e.id}`, e.lane)))}
      {row("Captions", capLanes * LANE_H + 4, caps.map((c) => block("caption", c.id, c.fromFrame, c.durationFrames, c.text, c.lane)))}
      <div className="muted" style={{ textAlign: "right" }}>{(frame / timeline.fps).toFixed(2)} s / {(total / timeline.fps).toFixed(2)} s</div>
    </section>
  );
}

function Inspector({ raw, selected, edit }: { raw: Raw; selected: Selected; edit: (body: Raw) => Promise<boolean> }) {
  const where = selected ? ({ clip: "story", element: "elements", caption: "captions" } as const)[selected.kind] : null;
  const index = where && Array.isArray(raw[where]) ? raw[where].findIndex((x: Raw) => x.id === selected!.id) : -1;
  const item = index >= 0 ? raw[where!][index] : null;
  const [text, setText] = useState("");
  useEffect(() => { setText(item ? JSON.stringify(item, null, 2) : ""); }, [JSON.stringify(item)]);
  if (!selected) return <section className="muted">Click a block of the timeline to edit it.</section>;
  if (!item) return <section className="muted">{selected.kind} {selected.id} is generated (from the transcript or the style): edit its source instead.</section>;
  const save = () => { let v; try { v = JSON.parse(text); } catch (e) { alert(`Not valid JSON: ${(e as Error).message}`); return; } void edit({ op: "set_value", pointer: `/${where}/${index}`, value: v }); };
  const nudge = (key: "inMs" | "outMs", d: number) => edit({ op: "update_item", collection: "story", id: item.id, changes: { [key]: Math.max(0, item[key] + d) } });
  const textProp = selected.kind === "element" && typeof item.props?.text === "string";
  return (
    <section>
      <strong>{selected.kind} {selected.id}</strong>
      {selected.kind === "clip" && (
        <div className="row" style={{ margin: "8px 0" }}>
          <span className="muted">start</span><button className="quiet" onClick={() => nudge("inMs", -100)}>-0.1 s</button><button className="quiet" onClick={() => nudge("inMs", 100)}>+0.1 s</button>
          <span className="muted">end</span><button className="quiet" onClick={() => nudge("outMs", -100)}>-0.1 s</button><button className="quiet" onClick={() => nudge("outMs", 100)}>+0.1 s</button>
        </div>
      )}
      {textProp && (
        <div className="row" style={{ margin: "8px 0" }}>
          <input style={{ flex: 1 }} defaultValue={item.props.text} key={item.props.text}
            onKeyDown={(e) => { if (e.key === "Enter") void edit({ op: "update_item", collection: "elements", id: item.id, changes: { props: { text: (e.target as HTMLInputElement).value } } }); }} />
          <span className="muted">Enter to save</span>
        </div>
      )}
      <textarea className="json" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="row">
        <button onClick={save}>Save</button>
        {selected.kind !== "clip" && <button className="quiet" onClick={() => { if (confirm(`Delete ${selected.kind} ${selected.id}?`)) void edit({ op: "set_value", pointer: `/${where}/${index}`, remove: true }); }}>Delete</button>}
      </div>
    </section>
  );
}

function Transcript({ raw, props, seek, edit }: { raw: Raw; props: RenderProps; seek: (f: number) => void; edit: (body: Raw) => Promise<boolean> }) {
  const [sel, setSel] = useState<{ asset: string; from: number; to: number } | null>(null);
  const [minPause, setMinPause] = useState(600);
  const words: Record<string, Word[]> = raw.transcript?.words ?? {};
  const story: Raw[] = raw.story ?? [];
  const kept = (asset: string, w: Word) => story.some((c) => c.asset === asset && w.startMs >= c.inMs && w.endMs <= c.outMs);
  const frameOf = (asset: string, ms: number) => {
    const c = props.timeline.clips.find((x) => x.asset === asset && ms >= x.sourceInMs && ms < x.sourceOutMs);
    return c ? c.fromFrame + Math.round(((ms - c.sourceInMs) * props.timeline.fps) / 1000) : null;
  };
  const chosen = sel ? words[sel.asset]!.slice(Math.min(sel.from, sel.to), Math.max(sel.from, sel.to) + 1) : [];
  return (
    <section>
      <div className="row" style={{ marginBottom: 8 }}>
        <strong>Transcript</strong>
        <span className="muted">click a word to jump, shift+click to select a passage</span>
        <button disabled={!chosen.length} onClick={async () => { if (await edit({ op: "cut_words", words: chosen.map((w) => w.id) })) setSel(null); }}>Cut {chosen.length ? `${chosen.length} word${chosen.length > 1 ? "s" : ""}` : "selection"}</button>
        <span className="muted">pauses over</span>
        <input type="number" step={100} value={minPause} onChange={(e) => setMinPause(Number(e.target.value))} style={{ width: 80 }} />
        <span className="muted">ms</span>
        <button className="quiet" onClick={() => edit({ op: "tighten", minPauseMs: minPause, keepMs: 200 })}>Tighten</button>
      </div>
      {Object.entries(words).map(([asset, list]) => (
        <p key={asset} className="words">
          <span className="muted">{asset} </span>
          {list.map((w, i) => {
            const inSel = sel?.asset === asset && i >= Math.min(sel.from, sel.to) && i <= Math.max(sel.from, sel.to);
            return (
              <span key={w.id} className={`word${kept(asset, w) ? "" : " cut"}${inSel ? " sel" : ""}`} title={`${w.id} ${(w.startMs / 1000).toFixed(2)} s`}
                onClick={(e) => {
                  if (e.shiftKey && sel?.asset === asset) setSel({ ...sel, to: i });
                  else setSel({ asset, from: i, to: i });
                  const f = frameOf(asset, w.startMs);
                  if (f !== null) seek(f);
                }}>{w.text} </span>
            );
          })}
        </p>
      ))}
    </section>
  );
}

export function Editor({ name }: { name: string }) {
  const [props, setProps] = useState<RenderProps | null>(null);
  const [raw, setRaw] = useState<Raw | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [frame, setFrame] = useState(0);
  const [selected, setSelected] = useState<Selected>(null);
  const player = useRef<PlayerRef>(null);
  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([api<RenderProps>(`/projects/${enc(name)}/preview`), api<Raw>(`/projects/${enc(name)}/raw`)]);
      setProps(p); setRaw(r); setError("");
    } catch (e) { setError((e as Error).message); }
  }, [name]);
  useEffect(() => {
    void load();
    const ev = new EventSource("/api/events");
    ev.onmessage = (m) => { if (JSON.parse(m.data).project === name) void load(); };
    return () => ev.close();
  }, [name]);
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const on = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", on);
    return () => p.removeEventListener("frameupdate", on);
  }, [props !== null]);
  const seek = (f: number) => { player.current?.seekTo(f); setFrame(f); };
  const edit = async (body: Raw): Promise<boolean> => {
    try {
      const r = await api<{ lint?: string[]; durationMs?: number; message?: string }>(`/projects/${enc(name)}/edit`, { method: "POST", body });
      setNote(r.message ?? (r.lint?.length ? r.lint.join("\n") : "Saved."));
      await load();
      return true;
    } catch (e) { setNote(""); setError((e as Error).message); return false; }
  };
  const t = props?.timeline;
  const playerEl = useMemo(() => t && props && (
    <Player ref={player} component={Edit} inputProps={props} durationInFrames={Math.max(1, t.durationFrames)} fps={t.fps}
      compositionWidth={t.width} compositionHeight={t.height} controls clickToPlay={false}
      style={{ width: "100%", maxHeight: "70vh", aspectRatio: `${t.width} / ${t.height}` }} />
  ), [props]);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1><a href={`#/p/${enc(name)}`} style={{ color: "inherit" }}>{name}</a> · editor</h1>
        <div className="row">
          <button className="quiet" onClick={() => edit({ op: "undo" })}>Undo</button>
          <a className="button" href={`#/p/${enc(name)}`}>Render and export</a>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <pre className="note">{note}</pre>}
      {props && raw && t && (
        <>
          <div className="editor-top">
            <div className="editor-player" style={{ maxWidth: t.width >= t.height ? "100%" : `calc(70vh * ${t.width / t.height})` }}>{playerEl}</div>
            <div className="editor-side"><Inspector raw={raw} selected={selected} edit={edit} /></div>
          </div>
          <Timeline props={props} frame={frame} selected={selected} select={setSelected} seek={seek} />
          <Transcript raw={raw} props={props} seek={seek} edit={edit} />
        </>
      )}
    </>
  );
}
