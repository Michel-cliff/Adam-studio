# 1015 acceptance

Rebuilds the creator's "1015 edit v2" (made in the ClaudeCapcut lab) as an Adam Studio project, then renders it
and exports it to CapCut (spec section 12). Nothing personal lives in this folder: the scripts read the lab and
write the project outside the repo.

Superseded for new projects by `npm run adam -- new` (sub-project 2); kept as the record of the 1015 acceptance.

```
C:\Users\miche\ClaudeCapcut\.tools\Scripts\python.exe spikes/acceptance-1015/build_cache.py   # analysis cache (about 15 min on 12 CPU threads)
py/capcut/.venv/Scripts/python spikes/acceptance-1015/make_project.py
py/capcut/.venv/Scripts/python spikes/acceptance-1015/check_cache.py
npm run adam -- render C:/Users/miche/AdamStudioProjects/1015
py/capcut/.venv/Scripts/python spikes/acceptance-1015/compare.py
py/capcut/.venv/Scripts/python -m adam_capcut export C:/Users/miche/AdamStudioProjects/1015 --name "1015 adam"
```

Tests: `py/capcut/.venv/Scripts/python -m pytest spikes/acceptance-1015/tests`.
