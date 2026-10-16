import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve";
import { WorkflowError, applyPatch, decide, newWorkflow } from "../src/workflow";
import { makeProject, makeStyle } from "./helpers";

/** A fully defaulted element: valid both as project input and as an already-parsed Element for applyPatch. */
const text = (id: string) => ({
  id, kind: "text.behindSubject", layer: "front" as const, anchor: { atMs: 0 }, durationMs: 1000,
  slot: "center", props: { text: id, color: "accent", sizeScale: 1 },
});

function guided() {
  return makeProject({
    workflow: newWorkflow(),
    proposals: [
      {
        id: "p1", step: "cuts", reason: "cut plan",
        variants: [
          { key: "A", label: "tight", patch: { setStory: [{ id: "c1", asset: "a", inMs: 0, outMs: 5000 }] } },
          { key: "B", label: "balanced", patch: { setStory: [{ id: "c1", asset: "a", inMs: 0, outMs: 8000 }] } },
          { key: "C", label: "loose", patch: { setStory: [{ id: "c1", asset: "a", inMs: 0, outMs: 9500 }] } },
        ],
      },
      {
        id: "p2", step: "visuals", reason: "mention of jobless.fr",
        variants: [{ key: "A", label: "word behind", patch: { addElements: [text("jobless")] } }],
      },
    ],
  });
}

describe("newWorkflow", () => {
  it("opens the cuts step and locks the others", () => {
    const wf = newWorkflow();
    expect(wf.current).toBe("cuts");
    expect(wf.steps).toEqual({
      cuts: "open", structure: "locked", captions: "locked", hook: "locked",
      beats: "locked", visuals: "locked", sound: "locked", look: "locked",
    });
  });
});

describe("decide", () => {
  it("applies the chosen variant and opens the next step", () => {
    const p = decide(guided(), "p1", "B");
    expect(p.story.map((c) => c.outMs)).toEqual([8000]);
    expect(p.proposals[0]!.status).toEqual({ accepted: "B" });
    expect(p.workflow).toMatchObject({ current: "structure", steps: { cuts: "done", structure: "open" } });
  });

  it("rejects without applying anything", () => {
    const before = guided();
    const p = decide(before, "p1", "reject");
    expect(p.story).toEqual(before.story);
    expect(p.proposals[0]!.status).toBe("rejected");
    expect(p.workflow!.steps.cuts).toBe("done");
  });

  it("asks for more: keeps the variants in history and stays pending", () => {
    const p = decide(guided(), "p1", "more", "less tight");
    const prop = p.proposals[0]!;
    expect(prop.status).toBe("pending");
    expect(prop.variants).toEqual([]);
    expect(prop.history).toHaveLength(1);
    expect(prop.history[0]).toMatchObject({ decision: "more", note: "less tight" });
    expect(prop.history[0]!.variants.map((v) => v.key)).toEqual(["A", "B", "C"]);
    expect(p.workflow!.current).toBe("cuts");
  });

  it("refuses a variant after more emptied the list", () => {
    const p = decide(guided(), "p1", "more");
    expect(() => decide(p, "p1", "A")).toThrow('proposal "p1" has no variant A');
  });

  it("refuses a proposal of a locked step", () => {
    expect(() => decide(guided(), "p2", "A")).toThrow(WorkflowError);
    expect(() => decide(guided(), "p2", "A")).toThrow(/locked/);
  });

  it("refuses to decide twice", () => {
    const p = decide(guided(), "p1", "A");
    expect(() => decide(p, "p1", "B")).toThrow('proposal "p1" is already decided');
  });

  it("refuses an unknown proposal", () => {
    expect(() => decide(guided(), "p9", "A")).toThrow(WorkflowError);
  });
});

describe("applyPatch", () => {
  it("adds and removes elements, appends captions, merges style overrides", () => {
    const base = makeProject({ elements: [text("old")] });
    const p = applyPatch(base, {
      removeElements: ["old"],
      addElements: [text("new")],
      addCaptions: [{ words: ["a.w0", "a.w1"], text: "zero un", highlight: [] }],
      setStyle: { colors: { highlight: "#00FF00" } },
    });
    expect(p.elements.map((e) => e.id)).toEqual(["new"]);
    expect(p.captions).toHaveLength(1);
    expect(p.styleOverrides).toEqual({ colors: { highlight: "#00FF00" } });
  });

  it("refuses an element id that already exists", () => {
    const base = makeProject({ elements: [text("x")] });
    expect(() => applyPatch(base, { addElements: [text("x")] })).toThrow('element id "x" already exists');
  });
});

describe("resolve with a virtual variant", () => {
  it("shows a pending variant only when asked", () => {
    const style = makeStyle();
    const p = guided();
    expect(resolve(p, style).elements).toEqual([]);
    expect(resolve(p, style, { apply: { proposal: "p2", variant: "A" } }).elements.map((e) => e.id)).toEqual(["jobless"]);
  });

  it("names a bad proposal or variant", () => {
    const style = makeStyle();
    expect(() => resolve(guided(), style, { apply: { proposal: "p2", variant: "C" } })).toThrow('proposal "p2" has no variant C');
  });
});
