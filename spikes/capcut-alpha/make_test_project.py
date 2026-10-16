"""Spike: does CapCut Desktop render video with an alpha channel?

Builds the CapCut project "adam_alpha_spike": a test pattern for 6 s, with an orange circle overlay that has
a transparent background, as WebM VP9 alpha from 0 to 3 s and as MOV ProRes 4444 from 3 to 6 s.

Run with the lab venv:
  C:\\Users\\miche\\ClaudeCapcut\\VectCutAPI\\.venv\\Scripts\\python spikes\\capcut-alpha\\make_test_project.py
"""
import os
import shutil
import subprocess
import sys

LAB = os.environ.get("ADAM_CAPCUT_LAB", r"C:\Users\miche\ClaudeCapcut\VectCutAPI")
sys.path.insert(0, LAB)

from pyJianYingDraft import Script_file, Timerange, Track_type, Video_material, Video_segment  # noqa: E402
from draft_profiles import get_draft_profile, write_profile_content  # noqa: E402

PROJECTS = os.path.expandvars(r"%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft")
NAME = "adam_alpha_spike"
MARKER = ".vectcut_generated"
US = 1_000_000
CIRCLE = "format=rgba,geq=r='255':g='107':b='53':a='if(lt(hypot(X-540-300*sin(2*T),Y-960),220),255,0)'"


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def main():
    dest = os.path.join(PROJECTS, NAME)
    if os.path.exists(dest):
        if not os.path.exists(os.path.join(dest, MARKER)):
            sys.exit(f"{dest} exists and was not created by this spike: refusing to touch it")
        if os.path.exists(os.path.join(dest, ".locked")):
            sys.exit("the spike project is open in CapCut: close it, then run again")
        shutil.rmtree(dest)
    profile = get_draft_profile()
    shutil.copytree(os.path.join(LAB, profile.template_dir), dest)
    open(os.path.join(dest, MARKER), "w").close()
    media = os.path.join(dest, "media")
    os.makedirs(media)

    bg = os.path.join(media, "bg.mp4")
    webm = os.path.join(media, "overlay.webm")
    mov = os.path.join(media, "overlay.mov")
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", bg)
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=3", "-vf", CIRCLE,
           "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "2M", webm)
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=3", "-vf", CIRCLE,
           "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", mov)

    script = Script_file(1080, 1920)
    m_bg = Video_material("video", path=bg, duration=6, width=1080, height=1920)
    m_webm = Video_material("video", path=webm, duration=3, width=1080, height=1920)
    m_mov = Video_material("video", path=mov, duration=3, width=1080, height=1920)
    for m in (m_bg, m_webm, m_mov):
        script.add_material(m)
    script.add_track(Track_type.video, "bg")
    script.add_track(Track_type.video, "overlay", relative_index=1)
    script.add_segment(Video_segment(m_bg, Timerange(0, 6 * US)), "bg")
    script.add_segment(Video_segment(m_webm, Timerange(0, 3 * US)), "overlay")
    script.add_segment(Video_segment(m_mov, Timerange(3 * US, 3 * US)), "overlay")
    write_profile_content(profile, dest, script.dumps(profile))
    print(dest)


if __name__ == "__main__":
    main()
