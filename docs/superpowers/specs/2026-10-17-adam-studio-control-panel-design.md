# Adam Studio control panel (sub-project 4, first part)

Date: 2026-10-17. Status: design approved in chat, spec to review.
Core spec: `docs/superpowers/specs/2026-10-16-adam-studio-core-design.md`. Analysis spec:
`docs/superpowers/specs/2026-10-16-adam-studio-analysis-design.md`.

## 1. Goal

The creator runs everything from a browser page instead of typing `npm run adam -- ...` and
`python -m adam_capcut export ...`. The page is a control panel over the existing commands: it does not
edit the timeline. Edits keep going through Claude, who writes `project.json`; the page shows the result.

Success: from a double-click, the creator creates a project from rushes on disk, analyzes, renders, reviews
and decides variants, exports to CapCut and opens Remotion Studio, watching each job live, without a
terminal.

Out of scope (the later web app of sub-project 4): preview player with timeline, transcript editing,
inspectors, a chat box. No remote access, no accounts.

## 2. Start

- `npm run ui` at the repo root starts the server and opens the default browser on it.
- `Adam Studio.cmd` at the repo root does the same on a double-click (it `cd`s to its own folder first).
- Address `http://127.0.0.1:4317`; `ADAM_UI_PORT` changes the port. If the port is taken by another Adam
  Studio panel, the command only opens the browser on it; otherwise it says which port is taken.
- Projects root: `ADAM_PROJECTS`, default `~/AdamStudioProjects`, changeable in the page (kept in
  `~/.adam-studio/ui.json`).

## 3. Architecture

New workspace package `packages/web`:
- `server/`: a Node HTTP server (node:http, no framework) with a JSON API, Server-Sent Events for job
  logs, and static files for the built page.
- `app/`: a React page built with Vite into `packages/web/dist`. `npm run ui` builds it when `dist` is
  missing or older than `app/`.

Every action runs as a child process with an argument array (never a shell string):
- the CLI: `node <tsx> packages/render/src/cli.ts <command> <dir> ...`, the same entry `npm run adam` uses;
- the CapCut export: `py/capcut/.venv/Scripts/python -m adam_capcut export <dir> [--name] [--force]
  [--replace]` (`ADAM_CAPCUT_PYTHON` overrides the path).

A crash in a render cannot stop the server, and all the tested behavior (lint, analysis on demand, CapCut
safety rules) stays in one place. The server reads project files directly only to display them; it never
writes `project.json` itself.

## 4. Pages

**Home.** The projects of the projects root (folders holding a `project.json`), each with its name,
format, number of takes and last render date. A button "New project".

**New project / Add rushes.** A folder browser over the local disk (drives, folders, and video files
`.mp4 .mov .mkv .m4v .avi .webm`), with checkboxes on the videos. Files are not copied: the project
points at them, as with the CLI. Fields for a new project: name (folder name in the projects root),
format 9:16 or 16:9, language (auto or a list: fr, en, ...). Runs `new` or `add`.

**Project.**
- Takes: id, file name, duration, the first words of the transcript, and the analysis state of each
  cache file (edit, proxy, transcript, silences, subject, plate: done, missing, or not needed).
- Buttons: Analyze, Render, Review, Export to CapCut, Open Studio.
- Render: the lint result is shown first (errors and warnings from `adam` itself, read from the job
  output). When the render refuses because of lint errors, the page offers "Render anyway" (`--force`).
- Export to CapCut: name field (default the project name). When the export refuses because the CapCut
  project was opened since the last export, the page asks before running again with `--replace`. Other
  refusals (`.locked`, project not created by the tool) are shown and never overridden by the page.
- Open Studio: starts `studio` as a long job and shows the link to Remotion Studio when it is printed;
  Stop ends it.
- Renders: the MP4 files of `renders/` with a video player, newest first.
- Review: for each proposal of `renders/review/<proposalId>/index.json`, the sheet and the A, B, C clips
  side by side, the variant labels, and buttons "Choose A/B/C", "Reject", "More" with an optional note.
  They run `decide`. Pending proposals without review clips get a "Render review" button.

**Jobs.** One job at a time per project; a second request on a busy project is refused with the name of
the running job. Each job shows its live output (stdout and stderr), its state (running, done, failed,
stopped) and a Stop button that ends the child process tree (`taskkill /T /F` on Windows). The last 20
jobs per project are kept in memory with their output.

**Live refresh.** The server watches each open project's `project.json`, `cache/` and `renders/`, and
pushes a change event; the page reloads that project. When Claude edits the project, the page follows.

## 5. API

All JSON, under `/api`:
- `GET /projects`, `GET /projects/:name` (project summary, takes, cache state, renders, review),
- `POST /projects` `{name, videos[], format, lang?}` runs `new`,
- `POST /projects/:name/add` `{videos[], lang?}`,
- `POST /projects/:name/jobs` `{action: analyze|render|review|decide|capcut|studio, options}`,
- `GET /jobs/:id`, `GET /jobs/:id/events` (SSE), `POST /jobs/:id/stop`,
- `GET /fs?path=` lists a folder (folders and video files only),
- `GET /projects/:name/files/<path>` serves a file of the project folder with HTTP range support (video
  seeking); paths are resolved and refused if they leave the project folder,
- `GET /events` (SSE) for project change events,
- `GET/PUT /settings` (projects root).

Options are validated per action before any process starts (for example `decide` needs a proposal id
and one of A, B, C, reject, more).

## 6. Safety

- The server listens on 127.0.0.1 only.
- Requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` are refused (DNS rebinding), and
  so are state-changing requests whose `Origin` is present and not the panel's own (other web sites).
- Project names are plain folder names (no separators, no `..`), resolved inside the projects root.
- File serving and the folder browser only read. Nothing in the panel deletes files.
- The CapCut rules of the core spec are enforced by the exporter itself, not by the page.

## 7. Errors

- A job that fails shows the last lines of its output as the message (the CLI already prints plain
  sentences, for example the missing analysis environment and how to create it).
- A missing Python environment (analysis or CapCut) is detected before the job and shown with the setup
  command from the README.
- A project whose `project.json` does not parse is listed with its error instead of hiding it.

## 8. Testing

- Server unit tests (vitest): request guards (Host, Origin, names, path escape), option validation per
  action, argument arrays built per action, one-job-per-project, range requests, job stop.
- One end-to-end test: start the server on a free port, create a project through the API from a
  generated test video, wait for the job over SSE, and check the project summary (skipped when the
  analysis environment is missing, like the CLI's own e2e test).
- The page is checked once in a real Chrome before hand-over: create, analyze, render, review and decide on
  the demo project.

## 9. Constraints

- No personal footage, transcripts or third-party assets committed; test media are generated.
- No em dash characters in texts the page shows.
- The user's CapCut projects 0901, 1015 (1) and 1015 edit v2 are never touched.
