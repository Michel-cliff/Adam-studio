# 0001: CapCut and video with an alpha channel

Context: the CapCut exporter (spec section 10) needs to know whether CapCut Desktop renders transparent
video overlays, to export elements without a native CapCut equivalent as overlays.

Test: `spikes/capcut-alpha/make_test_project.py` builds the CapCut project `adam_alpha_spike`: a test
pattern with an orange circle overlay, WebM VP9 alpha from 0 to 3 s and MOV ProRes 4444 from 3 to 6 s.
Checked by the creator in CapCut Desktop 9.3 on 2026-10-16.

| Container | Result in CapCut |
|---|---|
| WebM VP9 alpha (0 to 3 s) | opaque: the alpha channel is ignored, the whole frame shows the overlay's orange color |
| MOV ProRes 4444 (3 to 6 s) | transparent: the orange circle moves over the visible test pattern |

Decision: elements without a native equivalent are exported as transparent overlays in MOV ProRes 4444
(`prores_ks`, profile 4444, `yuva444p10le`). WebM VP9 alpha is never used for CapCut overlays: CapCut
ignores its alpha channel.
