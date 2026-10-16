# 0003: 1015 acceptance

Context: spec section 12 accepts the edit core when the creator's "1015" is described in `project.json`,
rendered to MP4 and exported to CapCut, and compared side by side with the lab's "1015 edit v2".

Built with `spikes/acceptance-1015` (see its README) on 2026-10-16, on the creator's machine (12 threads, CPU only).

| Measure | Value |
|---|---|
| Analysis cache build (8 clips, 87 s of footage) | about 14 min: edit.mp4 7 to 12 s, subject.webm 38 to 64 s, plate.png 45 to 72 s per clip; all 8 meet the cache contract |
| Project | 13 clips, 51 captions (none skipped), 64 elements |
| Lint | one warning: filler "bah" still in the edit |
| Render 1015.mp4 (64.7 s) | 5 min 16 s (8 min on the first run), 1080x1920, 30 fps, AAC |
| CapCut export "1015 adam" | 2 min 6 s; report: 13 baked (4 slides, 4 behind-subject words, 4 baked stretches, warmth), 127 native, 0 skipped |
| Warmth that matches v2 | 0.3: wall red minus blue 37, 37, 34 against v2's 37, 40, 35 at 23.6, 40.5 and 57.5 s (0.6 gave 50 to 53) |

Side by side with v2's baked shots (`renders/compare_v2.jpg`): the behind-subject words, the person-only slides
with their motion blur, the grade, the English captions with yellow words and the HUD frame match.

Known differences from v2, by design or model gap:
- The title: v2 drew it behind the creator's head and right-aligned; Adam draws it in front and centered, which keeps it
  editable text in CapCut (the creator's requirement). Setting the title's `layer` to `behind-subject` gives the v2 look,
  baked in CapCut. Text alignment is not in the model yet.
- The end card: v2 showed it 2.8 s past the last word over black; the story sets the video length, so it lasts until
  the end of the last clip.
- The final fade to black of v2 (0.5 s) has no equivalent in the model.
- HUD intro and outro durations: the renderer's presets (fade 250 ms, glitch 200 ms) replace v2's per-overlay durations.
- Captions start and end with the words they cover, not at v2's hand-set times.

Creator comparison ("1015 adam" next to "1015 edit v2" in CapCut, and `renders/1015.mp4`):

| Check | Result |
|---|---|
| Cuts and pacing | to fill |
| Grade and warmth | to fill |
| Title, behind-subject words, slides | to fill |
| Captions (English, yellow words, size) | to fill |
| HUD and sounds | to fill |

Decision: filled in with the creator (accepted, or the gaps to fix before sub-project 2).
