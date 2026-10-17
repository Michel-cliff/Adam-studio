export type JobState = "running" | "done" | "failed" | "stopped";
export type Hint = "force" | "replace" | null;
export interface JobView { id: string; project: string; label: string; state: JobState; output: string; startedAt: number; endedAt?: number; hint: Hint; link?: string }
export type JobEvent = { type: "output"; text: string } | { type: "end"; job: JobView };

export type CacheState = "done" | "missing" | "on demand";
export interface TakeView { id: string; file: string; durationMs: number | null; firstWords: string; cache: Record<string, CacheState> }
export interface RenderView { file: string; size: number; mtime: number }
export interface ProposalView { id: string; step: string; status: string; reason?: string; variants: { key: string; label: string; summary: string }[]; review: { sheet: string | null; clips: Record<string, string> } | null; anchor?: unknown; notes: string[] }
export interface WorkflowView { current: string; steps: Record<string, "locked" | "open" | "done"> }
export interface ProjectView { name: string; ok: boolean; error?: string; format?: string; takes: TakeView[]; renders: RenderView[]; proposals: ProposalView[]; jobs: JobView[]; workflow: WorkflowView | null; durationMs: number | null }
export interface ProjectListItem { name: string; ok: boolean; error?: string; format?: string; takes: number; lastRender: number | null }
export interface FolderView { path: string | null; parent: string | null; folders: string[]; videos: string[] }
