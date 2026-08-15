# Perf investigation — kiosk frame rate (2026-07-27)

**Status:** paused after measurement. Bottleneck localized but not yet fixed.
**Target:** ≥50 fps (20 ms/frame). **Actual:** 1.9–3.1 fps (322–536 ms/frame).
**Device:** Pi 5, `aero-display-00`, 2560×1080 @ 60 Hz, Chromium 150, commit `94ab394`.

---

## 1. The meter was broken first, and it hid a regression

Before any of the numbers below could be trusted, the fps metric had to be
fixed (PR #18). It was wrong in three independent ways:

| Defect | Effect |
|---|---|
| Integer-quantized per-second frame count | At 2–4 fps it divided ~3 frames by a ~1 s window, so it only ever emitted `0/2/3/5/15`. A 33 % regression could read as no change. |
| Off-by-one | N frames span N−1 intervals. 1.7 % error at 60 fps; **50 % at 2 fps** (reported 3, actual 2). |
| `fpsP50`/`fpsP95` were not frame rates | They were percentiles of the *model tick's own CPU cost* (~0.2 ms), excluding all rendering. `1000/0.2` ≈ 5000 fps, which is why they contradicted `fps` ~5×. |

**This is not academic.** PR #16 (`--use-gl=egl`) was merged as a "2 → 15 fps,
7.5× improvement" and was in fact a *regression*: that flag is not accepted by
this Chromium build (`angle|desktop|disabled|swiftshader` only), so it silently
became `--use-gl=disabled` — GPU off. The "improvement" was an artifact of the
broken meter. Reverted in PR #17.

Now: `fps = 1000 / median(frame period)`, from the real unclamped wall-clock
gap between frames. Fractional resolution, robust to a single stalled frame.
`fpsLow` (p95 period) exposes the stutter floor. Tick percentiles renamed
`tickMsP50`/`tickMsP95` so they can't be misread as a frame rate again.

> The game-loop `dt` is clamped to 100 ms for simulation stability. Never feed
> that clamped value to the meter — it pins every reading below 10 fps at
> exactly 10 fps.

---

## 2. It is not the simulation

`tickMsP50 = 0.2 ms` against a 322–536 ms frame. The model's entire
simulation step — flight, director, motion, config tree — is **0.04 % of the
frame**. Optimizing app logic is worthless here.

## 3. It is not fill rate (this is the surprising one)

Real framebuffer mode changes via xrandr, kiosk restarted per variant:

| mode | pixels | fps | pixel cut | fps gain |
|---|---|---|---|---|
| 2560×1080 | 2.76 MP | 3.1 | 1.00× | 1.00× |
| 1920×1080 | 2.07 MP | 2.7 | 1.33× | 0.87× |
| 1280×720 | 0.92 MP | 2.7 | 3.00× | 0.87× |
| 1024×768 | 0.79 MP | 4.4 | 3.49× | 1.42× |

**Cutting pixels 3× changed nothing.** Fill-rate-bound rendering would have
scaled roughly with the pixel cut. It didn't.

Consequence: **do not lower the display resolution.** It buys ≤1.4× against a
24× gap, and because the panel is 2.37:1 ultrawide, every available lower mode
(all 16:9 or 4:3) letterboxes or stretches the image. Cost in image quality,
no meaningful gain.

> `--force-device-scale-factor` is **not** a valid fill-rate test. It halves
> devicePixelRatio while doubling the CSS viewport, so the canvas backing store
> stays 2560 wide and the app just draws twice as much world. An earlier run
> using it produced a meaningless 1.37×.

## 4. It is not a dead GL backend

`glxinfo` reports `V3D 7.1.10.2` / Mesa 25.0.7 — real hardware GL, not
llvmpipe. GPU process confirms `--use-gl=angle --use-angle=gles`, no
SwiftShader. V3DV Vulkan is also present (`libvulkan_broadcom.so`), untested.

Hardware acceleration is already on. No flag will close a 24× gap.

---

## 5. Where that leaves the bottleneck

Fragment/fill work is ruled out by §3, simulation by §2, backend by §4. The
~300–500 ms is therefore **CPU-side per-frame work outside the model**:
Cesium's scene update, tile streaming/culling, draw-call submission, or the
Three postprocess chain (bloom, colour grade, city glow, stars, clouds).

## 6. Blocker: no A/B is trustworthy until the scene is pinned

Baseline read **1.9, then 3.1, then 1.9 fps** across three runs — a ~60 %
swing. The autopilot flies to a different city, weather and time-of-day every
window (observed `phoenix`/`clear`, others elsewhere), so each measurement
renders different content at wildly different cost.

**Any single measurement on this app is noise.** This is the same class of
error that let PR #16 through, and it will do it again.

---

## Next steps, in order

Operational checklist (kept current): **`docs/PI-PERF-PROCESS.md`** · `/wiki#perf`.

1. **Pinned-scene harness.** A URL/flag that fixes location, weather, time and
   disables the director, so two runs render identical content. Without this,
   step 2 cannot be read.
2. **Chromium trace** (`chrome://tracing` / `--trace-startup`) on the pinned
   scene to attribute the 300 ms: Cesium update vs draw submission vs
   postprocess passes vs GPU wait.
3. **Ablate the postprocess stack** one pass at a time against the pinned
   scene — the first real fix candidate.
4. Only then consider `--use-angle=vulkan` (V3DV is present), and expect
   little given §4.

## Do not repeat

- Do not trust a single fps reading (§6).
- Do not lower display resolution as a perf fix (§3).
- Do not use `--force-device-scale-factor` as a pixel-count test (§3).
- Do not assume a Chromium flag was accepted — check the GPU process argv, not
  the unit file. `--use-gl=egl` silently degraded to `disabled` (§1).
- Do not hand-write a systemd drop-in for the kiosk; derive `ExecStart` from
  the unit itself. A hand-written one broke the kiosk earlier.
