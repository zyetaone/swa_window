# UX Enhancement Proposals — Aero Window

> Captured 2026-04-13. Addresses: direction toggle, cylindrical world clarification,
> blind UX, long-press interactions, and Pi 5 photorealism.

---

## 1. Direction Toggle (Orbit Direction)

**Current:** `orbitAngle += angularSpeed * delta` — always increments (counter-clockwise).
No way to reverse the orbit direction.

**Fix:** Add `orbitDirection` to AeroWindow:

```typescript
orbitDirection = $state<1 | -1>(1); // 1 = CCW, -1 = CW

// In tickOrbit:
this.orbitAngle += angularSpeed * delta * this.orbitDirection;

// Toggle:
toggleOrbitDirection(): void { this.orbitDirection *= -1; }
```

**UX trigger:** Swipe left/right on the window reverses orbit direction.
Or: admin panel "Reverse" button per device.

---

## 2. Cylindrical World — Alignment

Rick's vision (clarified):

### Layer 1: SVG Cloud Slices (VERTICAL panels)

The clouds are NOT a horizontal band. They're **vertical slices** — like
looking through vertical glass panels with cloud shapes on them. Multiple
panels at different depths create parallax when the plane moves.

```
SIDE VIEW (looking at the installation):

  [Cloud slice 1]  [Cloud slice 2]  [Cloud slice 3]
       near             mid              far
    (big, fast)     (medium)       (small, slow)
         │               │               │
         ▼               ▼               ▼
  ┌──────────────────────────────────────────────┐
  │              CESIUM TERRAIN                   │
  │         (the cylindrical world)               │
  └──────────────────────────────────────────────┘
```

### Layer 2: Cylindrical World (BEHIND the clouds)

The terrain/sky wraps in a **cylinder** that the camera sits inside.
Instead of a flat Cesium globe with a fixed camera angle, imagine:

```
TOP-DOWN VIEW:

           ╭─── terrain wraps ───╮
          ╱                       ╲
         │    ●  camera (you)      │
         │    ↓  looking out       │
          ╲                       ╱
           ╰─── terrain wraps ───╯
```

The camera is INSIDE a cylinder textured with the terrain/sky panorama.
Each screen shows a different angular slice of this cylinder.
Walking past the 3 screens = panning around the cylinder.

### Implementation approaches

**Option A: Cesium camera rotation per screen (current plan)**

Each screen gets `viewer.camera.heading += screenOffset`. This uses Cesium's
native globe rendering from different angles. Simple, already possible,
but the "world" is still a globe — not a true cylinder.

**Option B: Pre-rendered panoramic cylinder**

Render a 360° panorama from Cesium at the current position → project onto
a CSS cylinder (or Three.js cylinder) → each screen shows a slice.
More control over the wrapping, but adds a render-to-texture step.

**Option C: CSS perspective cylinder for clouds only**

Keep Cesium flat (one angle per screen). The cloud slices use CSS
`perspective` + `translateZ` to create depth. Each screen's cloud
offset creates the cylindrical illusion for the atmospheric layer,
while the terrain stays flat. This is what our current CloudBlobs
already partially does with the perspective tilt.

**Recommended: Option A for terrain, Option C for clouds.** Cesium handles
the world (different heading per screen), CSS handles the atmosphere
(cloud slices at different depths per screen). The combination creates
the cylindrical illusion without actually rendering a cylinder.

---

## 3. Blind UX — Drag Direction

**Current:** Drag up/down to open/close. Snaps at 30% travel.

**Enhancement: "Where is the plane coming from?"**

The blind opens to reveal the destination. The DIRECTION of the blind
opening should match the flight direction:

```
Flying NORTH → blind slides UP (reveal from bottom)
Flying SOUTH → blind slides DOWN (reveal from top)
Flying EAST  → blind slides LEFT (reveal from right)
Flying WEST  → blind slides RIGHT (reveal from left)
```

**Implementation:**

```typescript
// In AeroWindow:
readonly blindDirection = $derived.by(() => {
    const h = this.heading % 360;
    if (h > 315 || h <= 45) return 'up';     // N
    if (h > 45 && h <= 135) return 'right';   // E
    if (h > 135 && h <= 225) return 'down';   // S
    return 'left';                             // W
});
```

The blind CSS transform changes from `translateY` to the appropriate axis.
This creates a subtle "the blind follows the direction of flight" effect.

**Simpler version:** blind always opens upward (current behavior) but add
a subtle **tilt** in the flight direction:

```css
.blind-overlay {
    transform: translateY(var(--drag-y)) rotate(var(--heading-tilt));
}
```

A 2-3° tilt in the heading direction makes the blind feel alive.

---

## 4. Long-Press Interactions

**Current:** 8-second long-press triggers flyTo (removed in kiosk mode).

**New interactions:**

| Gesture | Duration | Action |
|---------|----------|--------|
| Tap | instant | DISABLED (kiosk — use drag only) |
| Drag blind | any | Open/close blind (current) |
| Long-press 2s | 2 seconds | Speed up flight (3x → 5x → 10x while held) |
| Long-press + drag | any | Adjust altitude (drag up = higher, drag down = lower) |
| Two-finger pinch | any | Zoom in/out (adjusts altitude) |
| Swipe left/right | quick | Reverse orbit direction |
| Double-tap terrain | instant | Show location info tooltip |

**Speed ramp on long-press:**

```typescript
// In Window.svelte gesture handler:
let pressStartTime = 0;
let speedBoostActive = false;

function onPressStart() {
    pressStartTime = Date.now();
    speedBoostActive = false;
}

function onPressHold() {
    const held = (Date.now() - pressStartTime) / 1000;
    if (held > 2 && !speedBoostActive) {
        speedBoostActive = true;
        model.flightSpeed = 3.0;
    }
    if (held > 4) model.flightSpeed = 5.0;
    if (held > 6) model.flightSpeed = 10.0;
}

function onPressEnd() {
    if (speedBoostActive) {
        model.flightSpeed = 1.0; // restore normal speed
        speedBoostActive = false;
    }
}
```

The longer you hold, the faster the plane flies. Release returns to normal.
A visual indicator (speed lines? blur increase?) shows the acceleration.

---

## 5. Pi 5 Photorealism Enhancements

### What the Pi 5 16GB can handle (with fan + GPU turbo)

| Technique | GPU Cost | Visual Impact | Feasible? |
|-----------|----------|---------------|-----------|
| Cesium terrain + water mask | Low | High — coastlines shimmer | Already enabled |
| OSM Buildings 3D Tiles | Medium | High — city skylines | Phase 2 |
| NASA VIIRS night lights | Low | High — already have | ✅ |
| Cesium fog/atmosphere | Low | Medium — free depth haze | Enable `scene.fog` |
| Custom color grading GLSL | Low | High — circadian warmth | Already have |
| Gaussian splat (one city) | Medium | Very high — photorealistic | Phase 6+ |
| Terrain exaggeration | Zero | Medium — mountains pop | `viewer.scene.verticalExaggeration = 1.5` |
| Anti-aliasing (FXAA) | Low | Medium — smooth edges | `viewer.scene.fxaa = true` |
| Ambient occlusion | High | High — building shadows | Too expensive for Pi |
| Shadow mapping | High | High — time-of-day shadows | Too expensive for Pi |

### Quick wins to enable NOW

```javascript
// In CesiumManager.ts init:
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 0.0003;        // subtle atmospheric haze
viewer.scene.fxaa = true;                  // anti-aliasing (cheap)
viewer.scene.verticalExaggeration = 1.3;   // mountains more dramatic
viewer.scene.globe.enableLighting = true;  // sun-angle terrain shading
```

These four lines add significant photorealism at near-zero GPU cost.

### Chromium rendering flags for Pi 5

```bash
chromium --enable-gpu-rasterization     # ✅ already set
         --use-gl=angle                  # ✅ already set
         --use-angle=gles                # ✅ already set
         --enable-webgl                  # ✅ already set
         --enable-features=WebGPU        # NEW — future-proof
         --enable-zero-copy              # NEW — reduce copy overhead
         --gpu-rasterization-msaa-sample-count=0  # NEW — disable MSAA (save GPU)
         --disable-features=VizDisplayCompositor  # NEW — bypass Viz (less overhead)
```

### What's NOT feasible on Pi 5

- Real-time ray tracing (no RT cores)
- Volumetric clouds in shader (our SVG feTurbulence approach is better for Pi)
- High-res shadow mapping (V3D 7.1 fill rate too low)
- Multiple simultaneous Cesium viewers (one viewer per Pi maximum)

---

## 6. Minor UX/UI Improvements

### HUD enhancements

- Show destination city name during cruise transition
- Show "local time" for the current city (not just user's clock)
- Altitude in both feet and meters (small toggle)
- Speed indicator with animation (numbers roll)

### Accessibility

- High contrast mode for demo/presentation
- Screen reader support for location announcements
- Keyboard shortcuts: arrow keys for orbit speed/direction

### Visual polish

- Window frame metallic highlight shifts with "sunlight" (CSS gradient animation)
- Condensation droplets on glass during rain (small CSS dots)
- Lens flare when sun position is near the viewport edge
- Star twinkle brightness varies with altitude (higher = brighter)

### Kiosk hardening

- Auto-return to default location after 5 min of no interaction
- Screensaver mode: slowly rotating through all locations
- Admin "lock" mode: disable all touch except blind drag
- Error screen: if Cesium fails, show a beautiful static image + "Reconnecting..."

---

## Sources

- [Cesium explicit rendering optimization](https://cesium.com/blog/2018/01/24/cesium-scene-rendering-performance/)
- [Cesium WebGL multi-draw instancing](https://github.com/CesiumGS/cesium/issues/7595)
- [Cylindrical display projection](https://paulbourke.net/panorama/cylmapper/)
- [WebGL flight simulator](https://github.com/phuang17/FlightSimulator)
- [Three.js 360° panorama viewer](https://emanueleferonato.com/2014/12/10/html5-webgl-360-degrees-panorama-viewer-with-three-js/)
- [Cesium 3DTiles rendering optimization](https://www.mdpi.com/2076-3417/15/2/801)
