import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { exportSchemas, type Decision } from "@adam-studio/model";
import { addCommand, checkVideos, newProjectCommand } from "@adam-studio/web/server/actions";
import { safeName } from "@adam-studio/web/server/guards";
import { listProjects } from "@adam-studio/web/server/projects";
import { projectsRoot } from "@adam-studio/web/server/settings";
import { z } from "zod";
import { nameInRoot, runAction, runSetup, stills, tail } from "./run";
import { closeCurrentStep, decideProposal, patchProject, projectDir, propose, setValue, ToolError, undo, updateItem } from "./store";
import { projectSummary, transcriptText } from "./view";

const INSTRUCTIONS = `Adam Studio: video edits described in project.json (story clips cut from takes, elements anchored on words,
captions, style), rendered by Remotion and exported to CapCut. Times are milliseconds; word ids are "<take>.w<n>".
Start with get_project and get_transcript; get_reference gives the schemas (project, style, element kinds, frameworks).
Explicit requests from the creator: edit directly (apply_patch, update_item, set_value), then look with still.
Creative choices: propose one to three variants (A, B, C) with propose; the creator reviews them in the control panel
(npm run ui) or you render them with run review; decide records the choice. Guided steps run in order: cuts, structure,
captions, hook, beats, visuals, sound, look. Every write is validated and backed up: undo puts back the previous version.
Creator's taste so far: default effect animations feel a bit fast; lean slower.`;

const server = new McpServer({ name: "adam-studio", version: "0.1.0" }, { instructions: INSTRUCTIONS });
const root = () => projectsRoot();
const dirOf = (project: string) => projectDir(project, root());
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const written = (r: { lint: string[]; durationMs: number }) => text(`saved. duration ${r.durationMs} ms\n${r.lint.length ? r.lint.join("\n") : "lint: clean"}`);
const project = z.string().describe("project name in the projects folder, or an absolute path");

function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (args: z.infer<z.ZodObject<S>>) => Promise<any> | any) {
  server.registerTool(name, { description, inputSchema: shape }, (async (args: z.infer<z.ZodObject<S>>) => {
    try { return await fn(args); } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: e instanceof ToolError ? e.message : `${(e as Error).message}` }] };
    }
  }) as never);
}

tool("list_projects", "The projects of the projects folder.", {}, () => text(JSON.stringify({ root: root(), projects: listProjects(root()) }, null, 1)));

tool("get_project", "The whole project (without transcript words), its duration and lint.", { project }, ({ project: p }) => text(projectSummary(dirOf(p))));

tool("get_transcript", "Words with ids and times, and the pauses, per take; optionally one take and a range of the take.",
  { project, asset: z.string().optional(), fromMs: z.number().optional(), toMs: z.number().optional() },
  ({ project: p, ...o }) => text(transcriptText(dirOf(p), o)));

tool("get_reference", "JSON schemas and references: project, style, timeline, frameworks, kinds (list) or kind:<name>.",
  { topic: z.string() }, ({ topic }) => {
    const all = exportSchemas();
    if (topic === "kinds") return text(Object.keys(all).filter((k) => k.startsWith("kinds/")).map((k) => k.slice(6, -12)).join("\n"));
    const key = topic.startsWith("kind:") ? `kinds/${topic.slice(5)}.schema.json` : topic === "frameworks" ? "frameworks.json" : `${topic}.schema.json`;
    if (!(key in all)) throw new ToolError(`unknown topic "${topic}": project, style, timeline, frameworks, kinds, kind:<name>`);
    return text(JSON.stringify(all[key]));
  });

tool("apply_patch", "Applies a patch (the same shape as a variant's patch: addElements, addCaptions, setStory, setStructure, setStyle, removeElements).",
  { project, patch: z.record(z.string(), z.unknown()) }, ({ project: p, patch }) => written(patchProject(dirOf(p), patch)));

tool("update_item", "Deep-merges changes into one story clip or element, found by id (arrays and scalars replace).",
  { project, collection: z.enum(["story", "elements"]), id: z.string(), changes: z.record(z.string(), z.unknown()) },
  ({ project: p, collection, id, changes }) => written(updateItem(dirOf(p), collection, id, changes)));

tool("set_value", "Sets any value of project.json by JSON Pointer (e.g. /captions/0/text, /styleOverrides/grade/warmth); remove: true deletes it; /list/- appends.",
  { project, pointer: z.string(), value: z.unknown().optional(), remove: z.boolean().optional() },
  ({ project: p, pointer, value, remove }) => {
    if (!remove && value === undefined) throw new ToolError("give a value, or remove: true");
    return written(setValue(dirOf(p), pointer, remove ? undefined : value));
  });

tool("propose", "Adds a proposal {id, step, anchor?, reason, variants: [{key: A|B|C, label, patch}]}, or new variants for one sent back with \"more\".",
  { project, proposal: z.record(z.string(), z.unknown()) }, ({ project: p, proposal }) => written(propose(dirOf(p), proposal)));

tool("decide", "Records the creator's decision on a proposal: A, B or C applies that variant; reject; more asks for new variants.",
  { project, proposal: z.string(), decision: z.enum(["A", "B", "C", "reject", "more"]), note: z.string().optional() },
  ({ project: p, proposal, decision, note }) => written(decideProposal(dirOf(p), proposal, decision as Decision, note)));

tool("close_step", "Closes the current guided step when it needs no proposal, and opens the next.", { project },
  ({ project: p }) => written(closeCurrentStep(dirOf(p))));

tool("undo", "Puts back project.json as it was before the last change made through these tools.", { project },
  ({ project: p }) => text(undo(dirOf(p))));

tool("still", "Renders frames of the edit (or of a variant, \"p1:B\") and shows them.",
  { project, atMs: z.array(z.number()).min(1).max(6), variant: z.string().optional() },
  async ({ project: p, atMs, variant }) => {
    const { job, images } = await stills(dirOf(p), atMs, variant);
    if (job.state !== "done") return { isError: true, content: [{ type: "text" as const, text: tail(job) }] };
    return { content: images.flatMap((im, i) => [
      { type: "text" as const, text: `${atMs[i]} ms: ${im.file}` },
      { type: "image" as const, data: im.data, mimeType: "image/jpeg" },
    ]) };
  });

tool("run", "Runs analyze, render, review or capcut (export) and waits for it; shown live in the control panel when it is open. Options: analyze {assets, steps, force}; render {force}; review {step}; capcut {name, force, replace}.",
  { project, action: z.enum(["analyze", "render", "review", "capcut"]), options: z.record(z.string(), z.unknown()).optional() },
  async ({ project: p, action, options }) => {
    if (action === "capcut" && options?.replace) throw new ToolError("replace overwrites edits the creator made in CapCut: ask them, and let them press Replace in the panel");
    const job = await runAction(dirOf(p), root(), action, options ?? {});
    return { isError: job.state !== "done", content: [{ type: "text" as const, text: tail(job) }] };
  });

tool("create_project", "Creates a project in the projects folder from rushes (absolute paths) and runs the import analysis.",
  { name: z.string(), videos: z.array(z.string()).min(1), format: z.enum(["9:16", "16:9"]).default("9:16"), lang: z.string().optional() },
  async ({ name, videos, format, lang }) => {
    if (!safeName(name)) throw new ToolError(`not a valid project name: "${name}"`);
    const dir = join(root(), name);
    const job = await runSetup("new", name, newProjectCommand(dir, checkVideos(videos), format, lang), { name, videos, format, lang });
    return { isError: job.state !== "done", content: [{ type: "text" as const, text: tail(job) }] };
  });

tool("add_rushes", "Adds rushes (absolute paths) to a project and analyzes them.",
  { project, videos: z.array(z.string()).min(1), lang: z.string().optional() },
  async ({ project: p, videos, lang }) => {
    const dir = dirOf(p);
    const job = await runSetup("add", nameInRoot(dir, root()), addCommand(dir, checkVideos(videos), lang), { videos, lang });
    return { isError: job.state !== "done", content: [{ type: "text" as const, text: tail(job) }] };
  });

await server.connect(new StdioServerTransport());
