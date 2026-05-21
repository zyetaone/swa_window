# Ship Readiness — SWA Hyderabad

> Triage as of 2026-05-21 (Day 1 commits landed). Install: SATTVA Knowledge Park, end of May 2026.
> This doc survives `/compact` and is the agenda for the next council session.
> Tagged `pre-ship-v1` after Day 1.

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
- ✅ `shell.touchEnabled` gate (Day 1 commit `210eff9`) — passenger mode default; long-press accel + extras gated behind operator toggle
- ⚠ Touch gestures untested on real capacitive touchscreen
- ⏳ Corner-PIN gesture unlock + 10-min auto-revert (v1.1 deferred from Q3 council)
- ⏳ inputMode FSM (locked/armed/cooldown) cleanup — Day 6 task #62 (drag-during-cruise_transit silent swallow + multi-touch race)

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
- ✅ 21 scenarios in catalog with flight paths
- ✅ **`defaultShow` opens with dawn over Hyderabad (06:30, clear sky)** — Council Q2 (`557ad90`). Single hand-tuned hero frame, autopilot wanders from there. Choreographed multi-beat `hyderabad-launch.show.ts` rejected by the council; can be added post-validation if Day 2 GO completes with margin.
- ❓ Enough scenario variety for an unsupervised 8-hour day?

### Admin
- ✅ Fleet health dashboard
- ✅ Content drag-drop UI
- ✅ Bearer-gated mutating routes — now includes `/api/config` PATCH (Day 1 commit `77f244f`, Option B peer-token model)
- ✅ `/api/internal/peer-token` localhost-only route — kiosk Pi browser gets token without baking it in the bundle
- ❓ **Token distribution path**: who hands `AERO_ADMIN_TOKEN` to Zyeta ops? How do they store it? — **Day 7 task**
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

## 5. Questions for the council

**Resolved on 2026-05-20** (full memory: `~/.claude/projects/.../memory/project_council_q3_q5_q6_decisions.md`):

2. ✅ **Inauguration experience.** `defaultShow` amended to dawn over Hyderabad (06:30 / clear / 6.5). Single hand-tuned hero frame, not a choreographed timed sequence. Per Q2 council. Reversal criterion: if Day 2 GO completes with margin, optional 2–4hr Show authoring session for a richer opening hold (15–20s before autopilot first decision).

3. ✅ **Touch contract.** Off by default; blind drag preserved as the one curtain-metaphor gesture. Operator unlocks demo mode via `shell.touchEnabled = true` (side panel toggle today; corner-PIN deferred to v1.1).

5. ✅ **Failure modes.** Never break the fiction. 7-layer graceful degradation ladder authored in Day 6 hardening tasks (#58–63): hold last good frame, vignette pulse, cloud-cover overlay, `lastKnownGood` persistence, FSM watchdog, 3mm operator-only health dot, NEVER show error UI to audience.

6. ✅ **MapLibre fallback.** DROPPED. 3-of-4 council voices: untested hedges are theater. If Day 2 NO-GO fires, response is aggressive in-engine Cesium downgrade (`qualityMode: performance` + terrain off + 30fps cap). Catastrophic fallback only: pre-rendered MP4 loop. Not a renderer swap.

**Still open:**

1. **The 3-pane panorama seam.** Three Pis, 1m apart, showing yaw-offset slices of the same scene. The math works. But does it READ as one window, or as three coordinated displays? The answer is probably bezel-aware (do we matte the edges? do we exaggerate the parallax angle to FEEL more like one fuselage?). **→ Day 3 council session B.**

4. **The autopilot rhythm.** Currently the director picks a new scene every 100-160 seconds. Is that the right cadence for an OFFICE LOBBY (people glance for 5-30s and move on) versus a single-viewer kiosk? Calibration question. **→ Day 4 council session C.** (Note from Q3 game-designer lens: per-second motion beat at ~8s interval matters more than scene cadence for glancers; verify on hardware.)

---

## 6. What landed Day 1 (2026-05-21)

5 commits + `pre-ship-v1` tag pushed to origin/main:

| Commit | What |
|---|---|
| `013e151` | SSE ring-buffer replay + Pi 5 `--no-sandbox` rationale documented |
| `77f244f` | `/api/config` PATCH bearer-gated (Option B); localhost-only `/api/internal/peer-token` route; peer-sync auth wired; 258→274 tests |
| `557ad90` | `defaultShow` → dawn over Hyderabad (Council Q2) |
| `af3b97d` | `/architecture` page v1.1 — Time + Networking as hidden pillars; v1 voice preserved in `docs/ARCHITECTURE-original-framing.md` |
| `210eff9` | `shell.touchEnabled` gate — passenger mode default (Council Q3) |
| `1e74a63` | Stale numeric stats on architecture page fixed (14 locations / 21 scenarios / 108 files) |

**Day 6/7 hardening queued** from architect ultrathink + Q5 council (tasks #58–63):
- Frame-budget watchdog auto-downgrade
- `MIN_SANE_TIMESTAMP` gate on fleet connect
- NTP-drift echo in heartbeat → admin/fleet/health
- `lastKnownGood.svelte.ts` snapshot + FSM watchdog
- Failure-mode visual ladder (hold frame + cloud cover + vignette pulse + health dot)
- inputMode FSM cleanup (multi-touch race + cruise_transit drag swallow)
- Static fleet peer override (bypass mDNS for hotel LANs) — Day 7

**Next: Day 2 = Pi 5 hardware GO/NO-GO gate.** Flash a Pi, boot `pre-ship-v1`, run Shift+T telemetry for 30 min, decide GO if p95 ≤ 20ms over Cesium + bloom + clouds.

The codebase is ship-ready. The PRODUCT around the codebase has 2 open council questions (Q1 panorama seam, Q4 autopilot cadence — both Day 3/4) and one big remaining unknown: real Pi 5 hardware.
