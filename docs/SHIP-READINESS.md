# Ship Readiness — SWA Hyderabad

> Triage as of 2026-05-20. Install: SATTVA Knowledge Park, end of May 2026.
> This doc survives `/compact` and is the agenda for the next council session.

---

## 1. What we are actually shipping

An **airplane window in an office lobby**. Three Pi 5 displays side-by-side form ONE continuous window. People walk past, glance, see a place. Sometimes that place is Hyderabad. Sometimes Dubai. The view drifts gently. The time of day matches reality. Ambient art that happens to be a window.

Not a kiosk. Not a video wall. A *window*.

---

## 2. Experience layers (not code layers)

| # | Layer | What "good" means |
|---|---|---|
| 1 | **First glance** | Someone walking past slows down. They see DEPTH. |
| 2 | **Ambient hold** | Stays interesting for hours without demanding attention. Subtle drift, soft cloud passes, gentle weather. |
| 3 | **Curated moments** | When the director picks a new scene, the transition reads as deliberate. A trip, not a glitch. |
| 4 | **Touch invitation** | Pulling the blind down feels like a deliberate gesture. The window invites, never demands. |
| 5 | **3-pane continuity** | The three Pis read as ONE window. No seams. No clock skew. No "panel 2 just lagged." |

We're shipping in ~10 days. **Code quality is no longer the bottleneck. Physical validation is.**

---

## 3. Status by feature (what we have vs what's tested)

Legend: ✅ done & tested  ⚠ done but untested on real hardware  ❓ open question  🔴 unknown / risky

### Renderer
- ✅ Cesium globe + terrain + buildings + VIIRS night lights
- ✅ Bloom + color-grading shader + atmosphere
- ✅ T-threshold time-of-day pipeline (DAWN_START..DEEP_NIGHT)
- ⚠ Pi 5 ANGLE/GLES compatibility — never tried on the actual hardware
- 🔴 Sustained 60fps for hours under Cesium + bloom + clouds — never profiled

### Composition (scene effects)
- ✅ CSS3D cloud sprites + variants per weather
- ✅ Haze, lightning, micro-events
- ✅ Geo-positioned car-lights
- ⚠ Visual tuning has only ever been seen on a Mac monitor, not a Waveshare 21.5"

### Shell (UI)
- ✅ Pane / HUD / SidePanel / Blind / Glass / Weather
- ✅ Blind drag composable + accessibility
- ✅ Telemetry panel (Shift+T)
- ⚠ Touch gestures untested on real capacitive touchscreen

### Fleet (multi-Pi)
- ✅ REST + per-device SSE (no broker)
- ✅ mDNS LAN discovery (prod only — dev skips it)
- ✅ Parallax role bindings (URL + fingerprint + localStorage)
- ✅ Leader→follower `director_decision` with `transitionAtMs` future-stamp
- 🔴 **Never tested with ≥2 real Pis on a LAN**
- ⚠ NTP drift assumption (±200ms) — theoretical, not measured

### Content (authored)
- ✅ 14 locations including Hyderabad (set as inauguration default)
- ✅ Weather recipes (5 types)
- ✅ Sky palettes per `SkyState`
- ✅ Scenarios catalog with flight paths
- ❓ **Is there a "Hyderabad inauguration" show that prioritizes Hyderabad → Dubai → Mumbai progression?** Currently we have one generic default show.
- ❓ Enough scenario variety for an unsupervised 8-hour day?

### Admin
- ✅ Fleet health dashboard
- ✅ Content drag-drop UI
- ✅ Bearer-gated mutating routes
- ❓ **Token distribution path**: who hands `AERO_ADMIN_TOKEN` to Zyeta ops? How do they store it?
- ❓ **Recovery path** when a Pi wedges and the on-site operator is non-engineer

### Deploy
- ✅ Systemd units in `deploy/pi/`
- ✅ Tile packager
- ✅ CF push worker (optional OTA)
- 🔴 Pi 5 firmware version pinning — `--use-angle=gles` has historically broken on kernel updates
- ❓ Install runbook / step-by-step playbook does not exist

### Operations
- ✅ Telemetry ring buffer + viewer
- ✅ Wifi reset endpoint (gated)
- ✅ Auto-reload after 10 consecutive game-loop errors
- 🔴 Auto-recovery never tested end-to-end (would need an intentional crash on Pi)
- ❓ Remote support path if a Pi wedges off-LAN

---

## 4. The honest TODOs

### Blocking ship
1. **Validate on Pi 5 hardware** — minimum: one Pi 5 running the current build, holding 60fps for ≥30 min
2. **Multi-Pi smoke test** — two Pis on a LAN, confirm `transitionAtMs` sync produces simultaneous scene flips
3. **Touchscreen blind drag** — capacitive Waveshare 21.5", confirm the gesture feels right
4. **Tile-packager run for Hyderabad** — confirm PMTiles coverage at z3-z14 for the install locations
5. **Token + env-var distribution** — written runbook for `AERO_ADMIN_TOKEN`, `AERO_WIFI_RESET_TOKEN`, `VITE_CESIUM_ION_TOKEN`
6. **Install playbook** — step-by-step from Pi boot → kiosk loaded, validated once by someone non-Rick

### Nice-to-have pre-ship
7. **Inauguration show** — a curated `hyderabad-launch.show.ts` that opens on Hyderabad and progresses through ceremonially-relevant cities for the launch event
8. **Pi 5 60fps profile** — capture telemetry over 30 min, prove autoQuality stepping works
9. **Operator's one-page card** — laminated card with "press Shift+T for diagnostics, restart with `sudo systemctl restart aero-kiosk`, last-resort wipe via the wifi setup portal"

### Post-ship polish
10. Visual iteration on real hardware (color grade, bloom intensity, cloud density on the actual screen)
11. `admin/+page.svelte` split (986 LOC, mechanical)
12. `compose.ts` split (637 LOC, careful — production renderer)
13. Second show authoring

---

## 5. Questions for the council (post-compact)

These need **creative-technologist** thinking, not engineering grinding. Each is a "the codebase can answer the WHAT, but we need to figure out the WHY/HOW":

1. **The 3-pane panorama seam.** Three Pis, 1m apart, showing yaw-offset slices of the same scene. The math works. But does it READ as one window, or as three coordinated displays? The answer is probably bezel-aware (do we matte the edges? do we exaggerate the parallax angle to FEEL more like one fuselage?).

2. **The "inauguration" experience.** The first 60 seconds someone sees the SWA window at launch event. What plays? Currently we drop into "Hyderabad at local noon, cloudy" — fine but unscripted. Could this be a CHOREOGRAPHED show that ramps from dawn-over-Hyderabad → through clouds → into the day, timed to the inauguration ceremony? This is a content question, not a code question.

3. **The touch contract.** Currently: blind drag = fly to next location. The composable is solid. But what if touch is the wrong primitive for an office lobby — should the install be touch-disabled by default and only enable on a key combo from an operator iPad? "Look but don't touch" might be the right product call.

4. **The autopilot rhythm.** Currently the director picks a new scene every 100-160 seconds (per autopilot config). Is that the right cadence for an OFFICE LOBBY (people glance for 5-30s and move on) versus a single-viewer kiosk? Calibration question.

5. **What does "broken" look like?** When the install inevitably hiccups — a Pi loses LAN, Cesium hangs a frame, the touchscreen drifts — what's the FAILURE MODE we want? Black screen with logo? Frozen last frame? Cycling between known-good cached imagery? The fallback experience is the experience under stress.

6. **The MapLibre v2 question.** We archived it. Was that the right call? The Cesium-on-Pi-5 risk is real; MapLibre + PMTiles ships smaller and is OSS-pure. If physical validation reveals Cesium can't hold 60fps, do we have a 2-day path to MapLibre fallback or is that a re-write?

---

## 6. What the council session should produce

- Decisions on questions 1–6 above
- A `hyderabad-launch.show.ts` if #2 lands as "yes, choreograph it"
- A written install runbook
- A Pi 5 firmware version we commit to (and pin)
- Token distribution mechanism (encrypted envelope? operator iPad?)

The codebase is ship-ready. The PRODUCT around the codebase has the open questions now.
