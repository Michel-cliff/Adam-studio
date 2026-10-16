# 0002: CapCut export, manual check

Context: spec section 12 asks for one manual check of an exported project in CapCut Desktop. The
automated tests check the project JSON; only CapCut shows whether it plays as the renderer does.

How: add a title to the demo project, export it, open it in CapCut Desktop, compare with
`npm run adam -- render C:\Users\miche\AdamStudioProjects\demo` (the MP4 of the same project).

    py/capcut/.venv/Scripts/python -m adam_capcut export C:\Users\miche\AdamStudioProjects\demo --name "adam demo"

| Check | Expected | Result |
|---|---|---|
| The project opens with no missing media | all media found | to fill |
| Main track | 5 segments; red and blue take, gray during the slide | to fill |
| 0.3 to 0.9 s | magenta image behind the green square (baked) | to fill |
| 1.8 to 2.4 s | the square slides out left and back from the right over gray (baked) | to fill |
| 0.2 to 1.4 s | caption "red blue", "blue" in yellow, size close to the MP4 | to fill |
| 2.5 to 3.0 s | the title "HELLO" as CapCut text you can edit, title font, Glitch entrance | to fill |
| Grade | the take as warm as in the MP4; brightness, contrast, saturation and vignette adjustable | to fill |
| 1.0 s | the beep is heard | to fill |

Decision: filled in after the check (caption size factor kept or corrected, anything CapCut rejects).
