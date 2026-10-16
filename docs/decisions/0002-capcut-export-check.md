# 0002: CapCut export, manual check

Context: spec section 12 asks for one manual check of an exported project in CapCut Desktop. The
automated tests check the project JSON; only CapCut shows whether it plays as the renderer does.

How: the demo project (`C:\Users\miche\AdamStudioProjects\demo`) uses the warm grade (warmth 0.35,
contrast 0.1, saturation 0.12, brightness -0.02, vignette 0.35) and Indivisible (CapCut resource
7181740482383319553) for captions and titles. It is exported to CapCut and rendered to MP4, then both are
compared side by side:

    py/capcut/.venv/Scripts/python -m adam_capcut export C:\Users\miche\AdamStudioProjects\demo --name "adam demo"
    npm run adam -- render C:\Users\miche\AdamStudioProjects\demo

| Check | Expected | Result |
|---|---|---|
| Opening | "adam demo" opens with no missing media | to fill |
| Main track | 5 segments: red and blue take, two baked stretches | to fill |
| 0.3 to 0.9 s | magenta image behind the green square (baked) | to fill |
| 0.3 s and 0.9 s, 1.8 s and 2.4 s | no color or brightness jump where a baked stretch starts or ends | to fill |
| 1.8 to 2.4 s | the square slides out left and back from the right over gray (baked) | to fill |
| 0.2 to 1.4 s | caption "créé ma boîte" in Indivisible, "boîte" in yellow, outline and shadow, size close to the MP4 | to fill |
| 2.5 to 3.3 s | title texts you can edit: kicker "ÉPISODE 3", "QUI VEUT", "M'EMBAUCHER ?" on an orange box, then "PERSONNE"; Indivisible; Glitch entrances; placed like the MP4 | to fill |
| 3.4 to 3.8 s | magenta photo fades in and leaves with RGB Scanlines | to fill |
| Grade | as warm as the MP4; brightness, contrast, saturation keyframes and the Vignette effect adjustable | to fill |
| 1.0 s | the beep is heard | to fill |

Not covered by this check (follow-up): a 16:9 project, `fit` and `crop` framing, overlays of kinds without a
native equivalent (none exist in v1).

Decision: filled in after the check (caption and title size factor kept or corrected, anything CapCut rejects).
