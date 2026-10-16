# Adam Studio

An open source video editing system driven by Claude: describe the edit, review three variants at every
step, render the final MP4 yourself, or export a native CapCut project to finish by hand.

Status: sub-project 1 (the edit core) in progress. See `docs/superpowers/specs/` for the design.

## Packages

- `packages/model`: the project format (zod schemas), `resolve()` from word-anchored edits to a frame
  timeline, `lint()` for the reels rules (hook in 3 s, pauses, fillers, duration, narrative beats),
  transcript editing (`cutWords`, `restoreWords`, `trimToWords`), and the guided workflow (`decide()`).

## Development

Requirements: Node 24 or later.

    npm install
    npm test
    npm run typecheck
    npm run export-schemas -w @adam-studio/model

Projects and media live outside this repository; never commit footage or third-party assets.

## A note on Remotion

The renderer (coming in the next plan) uses Remotion, which is free for individuals and companies of up
to 3 people. Larger companies reusing Adam Studio need their own Remotion company license.

## License

MIT
