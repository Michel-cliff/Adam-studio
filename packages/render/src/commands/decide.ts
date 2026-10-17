import { decide, resolve, type Decision, type Project } from "@adam-studio/model";
import { CliError, loadProject, saveProject } from "../project-io";

const DECISIONS = ["A", "B", "C", "reject", "more"];

export function decideCommand(projectDir: string, proposalId: string, decision: string, note?: string): Project {
  if (!DECISIONS.includes(decision)) {
    throw new CliError(`decision must be A, B, C, reject or more, got "${decision}"`);
  }
  const { dir, project, style } = loadProject(projectDir);
  const next = decide(project, proposalId, decision as Decision, note);
  // Refuse a variant whose patch would leave a project that no longer resolves (an invalid style change).
  try { resolve(next, style); } catch (e) { throw new CliError(`variant ${decision} of ${proposalId} cannot be applied: ${(e as Error).message}`); }
  saveProject(dir, next);
  console.log(`${proposalId}: ${decision}${note ? ` (${note})` : ""}; current step: ${next.workflow?.current ?? "none"}`);
  return next;
}
