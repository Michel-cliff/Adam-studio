import { decide, type Decision, type Project } from "@adam-studio/model";
import { CliError, loadProject, saveProject } from "../project-io";

const DECISIONS = ["A", "B", "C", "reject", "more"];

export function decideCommand(projectDir: string, proposalId: string, decision: string, note?: string): Project {
  if (!DECISIONS.includes(decision)) {
    throw new CliError(`decision must be A, B, C, reject or more, got "${decision}"`);
  }
  const { dir, project } = loadProject(projectDir);
  const next = decide(project, proposalId, decision as Decision, note);
  saveProject(dir, next);
  console.log(`${proposalId}: ${decision}${note ? ` (${note})` : ""}; current step: ${next.workflow?.current ?? "none"}`);
  return next;
}
