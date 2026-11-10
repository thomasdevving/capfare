"""Composites a real webcam recording and voice-over into a rendered cut.

    python3 video/render/composite.py --cut full --camera cam.mp4 [--voice voice.wav] [--offset 0]

* --camera: your webcam video, recorded in sync with the film (start recording when the film
  starts; --offset shifts it if it started later, in seconds). Each placeholder from
  video/webcam-<cut>.json is replaced by the camera at that time: scaled to fill the rect,
  cropped to the centre, masked to a circle or a rounded rectangle, with the same fades.
* --voice: your voice-over (same timeline). It is mixed over the music, which already ducks under
  the caption spans, and the effects. Without --voice the original mix is kept.

Reads video/out/<cut>/<cut>.mp4 (from the encode step) and video/audio/<cut>/ stems; writes
video/out/<cut>/<cut>-final.mp4. Prints the ffmpeg command it runs.
"""
import argparse, json, os, subprocess

ap = argparse.ArgumentParser()
ap.add_argument("--cut", default="full")
ap.add_argument("--camera", required=True)
ap.add_argument("--voice")
ap.add_argument("--offset", type=float, default=0.0)
a = ap.parse_args()

V = os.path.join(os.path.dirname(__file__), "..")
cams = json.load(open(os.path.join(V, f"webcam-{a.cut}.json")))
src = os.path.join(V, "out", a.cut, f"{a.cut}.mp4")
out = os.path.join(V, "out", a.cut, f"{a.cut}-final.mp4")

f = []
last = "0:v"
for i, k in enumerate(cams):
    w, h, x, y = k["w"], k["h"], k["x"], k["y"]
    t0, t1 = k["start"], k["end"]
    fi, fo = (k.get("fullStart") or t0) - t0, t1 - (k.get("fullEnd") or t1)
    # Mask: circle, or rounded rectangle with radius 26 px.
    if k["round"]:
        alpha = f"if(lte(hypot(X-{w/2},Y-{h/2}),{w/2}),255,0)"
    else:
        r = 26
        alpha = (f"if(gt(abs(X-{w/2}),{w/2 - r})*gt(abs(Y-{h/2}),{h/2 - r}),"
                 f"if(lte(hypot(abs(X-{w/2})-{w/2 - r},abs(Y-{h/2})-{h/2 - r}),{r}),255,0),255)")
    f.append(
        f"[1:v]trim=start={t0 + a.offset:.3f}:end={t1 + a.offset:.3f},setpts=PTS-STARTPTS+{t0:.3f}/TB,"
        f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},format=yuva420p,"
        f"geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='{alpha}',"
        f"fade=t=in:st={t0:.3f}:d={max(fi, 0.01):.3f}:alpha=1,fade=t=out:st={t1 - max(fo, 0.01):.3f}:d={max(fo, 0.01):.3f}:alpha=1[c{i}]"
    )
    f.append(f"[{last}][c{i}]overlay={x}:{y}:enable='between(t,{t0:.3f},{t1:.3f})'[v{i}]")
    last = f"v{i}"

cmd = ["ffmpeg", "-y", "-i", src, "-i", a.camera]
amap = ["-map", "0:a"]
if a.voice:
    A = os.path.join(V, "audio", a.cut)
    cmd += ["-i", os.path.join(A, "music.wav"), "-i", os.path.join(A, "sfx.wav"), "-i", a.voice]
    # Duck the music under the actual voice (sidechain), keep effects, add the voice.
    f.append("[4:a]asplit=2[vo][sc];[2:a][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[m];"
             "[m][3:a][vo]amix=inputs=3:weights='0.8 1 1.2':normalize=0,loudnorm=I=-15:TP=-2:LRA=11[aout]")
    amap = ["-map", "[aout]"]
cmd += ["-filter_complex", ";".join(f), "-map", f"[{last}]", *amap,
        "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]
print(" ".join(f"'{c}'" if " " in c or ";" in c else c for c in cmd))
subprocess.run(cmd, check=True)
print("wrote", out)
