import { STEP_IDS, type Patch, type Project, type Proposal, type StepId, type VariantKey, type Workflow } from "./schema/project";
import { deepMerge } from "./merge";

export class WorkflowError extends Error {}

export type Decision = VariantKey | "reject" | "more";

export function newWorkflow(): Workflow {
  const steps = Object.fromEntries(STEP_IDS.map((s) => [s, s === "cuts" ? "open" : "locked"])) as Workflow["steps"];
  return { current: "cuts", steps };
}

export function applyPatch(project: Project, patch: Patch): Project {
  let next: Project = { ...project };
  if (patch.setStory) next = { ...next, story: patch.setStory };
  if (patch.setStructure) next = { ...next, structure: patch.setStructure };
  if (patch.removeElements) {
    const rm = new Set(patch.removeElements);
    next = { ...next, elements: next.elements.filter((e) => !rm.has(e.id)) };
  }
  if (patch.addElements) {
    const ids = new Set(next.elements.map((e) => e.id));
    for (const e of patch.addElements) {
      if (ids.has(e.id)) throw new WorkflowError(`element id "${e.id}" already exists`);
      ids.add(e.id);
    }
    next = { ...next, elements: [...next.elements, ...patch.addElements] };
  }
  if (patch.addCaptions) next = { ...next, captions: [...next.captions, ...patch.addCaptions] };
  if (patch.setStyle) next = { ...next, styleOverrides: deepMerge(next.styleOverrides, patch.setStyle) };
  return next;
}

/** Closes the current step when all its proposals are decided, and opens the next one. */
function advance(project: Project): Project {
  const wf = project.workflow;
  if (!wf) return project;
  const steps = { ...wf.steps };
  let current: StepId = wf.current;
  for (;;) {
    const ofStep = project.proposals.filter((p) => p.step === current);
    if (steps[current] !== "open" || ofStep.length === 0 || ofStep.some((p) => p.status === "pending")) break;
    steps[current] = "done";
    const nextStep = STEP_IDS[STEP_IDS.indexOf(current) + 1];
    if (!nextStep) break;
    steps[nextStep] = "open";
    current = nextStep;
  }
  return { ...project, workflow: { current, steps } };
}

export function decide(project: Project, proposalId: string, decision: Decision, note?: string): Project {
  const idx = project.proposals.findIndex((p) => p.id === proposalId);
  if (idx < 0) throw new WorkflowError(`unknown proposal "${proposalId}"`);
  const p = project.proposals[idx]!;
  if (p.status !== "pending") throw new WorkflowError(`proposal "${p.id}" is already decided`);
  const wf = project.workflow;
  if (wf && wf.steps[p.step] === "locked") {
    throw new WorkflowError(`step "${p.step}" is locked: finish "${wf.current}" first`);
  }
  let next = project;
  let updated: Proposal;
  if (decision === "reject") {
    updated = { ...p, status: "rejected" };
  } else if (decision === "more") {
    const entry = note === undefined
      ? { variants: p.variants, decision: "more" as const }
      : { variants: p.variants, decision: "more" as const, note };
    updated = { ...p, variants: [], history: [...p.history, entry] };
  } else {
    const v = p.variants.find((x) => x.key === decision);
    if (!v) throw new WorkflowError(`proposal "${p.id}" has no variant ${decision}`);
    next = applyPatch(project, v.patch);
    updated = { ...p, status: { accepted: decision } };
  }
  next = { ...next, proposals: next.proposals.map((x, i) => (i === idx ? updated : x)) };
  return advance(next);
}
