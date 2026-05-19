# Volumetric Clouds + Architecture Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace CSS blur-gradient clouds with volumetric raymarched clouds via Threlte, fix the favicon 404, and add live layer previews to the architecture page.

**Architecture:** Threlte `<Canvas>` overlays Cesium at z:1 with a transparent WebGL context. A custom FBM raymarching shader (adapted from user reference code) renders volumetric clouds driven by AeroWindow state. The architecture page gets self-contained CSS animation previews per layer plus a mini Threlte cloud canvas.

**Tech Stack:** Svelte 5, Threlte 8, Three.js, custom GLSL (FBM raymarching), Cesium (existing)

**Design:** `docs/plans/2026-02-18-clouds-and-architecture-design.md`

**Note on @takram/three-clouds:** Research revealed it requires the `postprocessing` pmndrs library and is R3F-centric. The user's FBM raymarching reference code provides equivalent visual quality with zero extra dependencies beyond Three.js. We use that shader instead.

---

## Task 1: Favicon Fix

**Files:**
- Create: `static/favicon.svg`
- Modify: `src/app.html:4-6`

**Step 1: Create airplane-window SVG favicon**

Create `static/favicon.svg` — a minimal airplane window icon using the project's brand blue (#304cb2):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#0a0a1e"/>
  <ellipse cx="16" cy="16" rx="9" ry="12" fill="none" stroke="#304cb2" stroke-width="2.5"/>
  <ellipse cx="16" cy="16" rx="7" ry="10" fill="#1a1a3a"/>
  <ellipse cx="16" cy="12" rx="5" ry="4" fill="#4a7ab5" opacity="0.6"/>
</svg>
```

**Step 2: Add favicon link to app.html**

In `src/app.html`, add inside `<head>` before `%sveltekit.head%`:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
```

**Step 3: Verify**

Run: `npm run dev`
Expected: No `[404] GET /favicon.ico` in terminal. Browser tab shows the airplane window icon.

**Step 4: Commit**

```bash
git add static/favicon.svg src/app.html
git commit -m "fix: add favicon to resolve 404"
```

---

## Task 2: Install Threlte Dependencies

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts:28-35`

**Step 1: Install packages**

```bash
npm install three @threlte/core @threlte/extras
npm install -D @types/three
```

**Step 2: Add Three.js to manual chunks in vite.config.ts**

In `vite.config.ts:28-35`, update `manualChunks`:

```typescript
manualChunks(id) {
  if (id.includes('node_modules')) {
    if (id.includes('cesium')) {
      return 'cesium';
    }
    if (id.includes('three') || id.includes('@threlte')) {
      return 'three';
    }
  }
  return undefined;
},
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds. Output shows a `three-XXXXX.js` chunk alongside the existing `cesium-XXXXX.js` chunk.

**Step 4: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "chore: add threlte and three.js dependencies"
```

---

## Task 3: Cloud Shader (GLSL)

**Files:**
- Create: `src/lib/layers/cloud-shader.ts`

**Step 1: Create the volumetric cloud GLSL shader**

This shader is adapted from the user's FBM raymarching reference code. It renders volumetric clouds on a fullscreen quad with:
- FBM noise for cloud density (4 octaves)
- Raymarching through the cloud volume
- Shadow marching for self-shadowing
- Sun-lit coloring with configurable cloud/sky colors

Create `src/lib/layers/cloud-shader.ts`:

```typescript
/**
 * Volumetric Cloud Shaders
 *
 * FBM raymarching shader for volumetric clouds rendered on a fullscreen quad.
 * Adapted for the Aero Window pipeline — uniforms driven by AeroWindow state.
 */

export const CLOUD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export const CLOUD_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3 uCloudSize;
  uniform vec3 uSunPosition;
  uniform vec3 uCameraPosition;
  uniform vec3 uCloudColor;
  uniform vec3 uSkyColor;
  uniform float uCloudSteps;
  uniform float uShadowSteps;
  uniform float uCloudLength;
  uniform float uShadowLength;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uFocalLength;
  uniform float uDensity;

  // 3D FBM noise — https://shadertoy.com/view/lss3zr
  mat3 m = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

  float hash(float n) {
    return fract(sin(n) * 43758.5453);
  }

  float noise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0 + 113.0 * p.z;
    return mix(
      mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
          mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
      mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
          mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float f = 0.0;
    f += 0.5000 * noise(p); p = m * p * 2.02;
    f += 0.2500 * noise(p); p = m * p * 2.03;
    f += 0.1250 * noise(p); p = m * p * 2.01;
    f += 0.0625 * noise(p);
    return f;
  }

  float cloudDepth(vec3 position) {
    float ellipse = 1.0 - length(position * uCloudSize);
    float cloud = ellipse + fbm(position + uTime * 0.02) * 2.2;
    return clamp(cloud * uDensity, 0.0, 1.0);
  }

  vec4 cloudMarch(float jitter, vec3 position, vec3 ray) {
    float stepLength = uCloudLength / uCloudSteps;
    float shadowStepLength = uShadowLength / uShadowSteps;
    vec3 lightDirection = normalize(uSunPosition);
    vec3 cloudPosition = position + ray * jitter * stepLength;
    vec4 color = vec4(0.0, 0.0, 0.0, 1.0);

    for (float i = 0.0; i < 48.0; i++) {
      if (i >= uCloudSteps) break;
      if (color.a < 0.1) break;

      float depth = cloudDepth(cloudPosition);
      if (depth > 0.001) {
        vec3 lightPosition = cloudPosition + lightDirection * jitter * shadowStepLength;
        float shadow = 0.0;
        for (float s = 0.0; s < 8.0; s++) {
          if (s >= uShadowSteps) break;
          lightPosition += lightDirection * shadowStepLength;
          shadow += cloudDepth(lightPosition);
        }
        shadow = exp((-shadow / uShadowSteps) * 3.0);

        float density = clamp((depth / uCloudSteps) * 20.0, 0.0, 1.0);
        color.rgb += vec3(shadow * density) * uCloudColor * color.a;
        color.a *= 1.0 - density;
        color.rgb += density * uSkyColor * color.a;
      }
      cloudPosition += ray * stepLength;
    }

    return color;
  }

  mat3 lookAt(vec3 target, vec3 origin) {
    vec3 cw = normalize(origin - target);
    vec3 cu = normalize(cross(cw, origin));
    vec3 cv = normalize(cross(cu, cw));
    return mat3(cu, cv, cw);
  }

  void main() {
    vec2 pixel = (gl_FragCoord.xy * 2.0 - uResolution) / min(uResolution.x, uResolution.y);
    float jitter = hash(pixel.x + pixel.y * 50.0 + uTime);

    mat3 camera = lookAt(uCameraPosition, vec3(0.0, 1.0, 0.0));
    vec3 ray = camera * normalize(vec3(pixel, uFocalLength));

    vec4 color = cloudMarch(jitter, uCameraPosition, ray);
    // Pre-multiplied alpha: cloud color + sky color through transparency
    vec3 finalColor = color.rgb + uSkyColor * color.a;

    // Output with alpha for transparent canvas compositing
    float alpha = 1.0 - color.a;
    gl_FragColor = vec4(finalColor * alpha, alpha);
  }
`;
```

**Step 2: Verify types**

Run: `npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors (this is a plain .ts file with string exports)

**Step 3: Commit**

```bash
git add src/lib/layers/cloud-shader.ts
git commit -m "feat: add volumetric cloud FBM raymarching shader"
```

---

## Task 4: CloudCanvas Svelte Component

**Files:**
- Create: `src/lib/layers/CloudCanvas.svelte`

This component wraps a Threlte `<Canvas>` with a transparent WebGL renderer, renders a fullscreen quad with the cloud shader, and exposes uniforms driven by props.

**Step 1: Create CloudCanvas.svelte**

```svelte
<script lang="ts">
  /**
   * CloudCanvas - Threlte-powered volumetric cloud overlay
   *
   * Renders raymarched FBM clouds on a transparent WebGL canvas.
   * Designed to overlay Cesium at z:1 with pointer-events: none.
   *
   * Props drive shader uniforms — synced from AeroWindow in Window.svelte.
   */
  import { Canvas } from '@threlte/core';
  import * as THREE from 'three';
  import VolumetricClouds from './VolumetricClouds.svelte';

  interface Props {
    density?: number;
    cloudSpeed?: number;
    nightFactor?: number;
    dawnDuskFactor?: number;
    skyState?: 'day' | 'night' | 'dawn' | 'dusk';
    time?: number;
    advance?: () => void;
  }

  let {
    density = 0.5,
    cloudSpeed = 1.0,
    nightFactor = 0,
    dawnDuskFactor = 0,
    skyState = 'day',
    time = 0,
  }: Props = $props();
</script>

<div class="cloud-canvas-wrapper">
  <Canvas
    createRenderer={(canvas) => {
      return new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
        powerPreference: 'high-performance',
        premultipliedAlpha: false,
      });
    }}
    renderMode="manual"
    autoRender={false}
  >
    <VolumetricClouds
      {density}
      {cloudSpeed}
      {nightFactor}
      {dawnDuskFactor}
      {skyState}
      {time}
    />
  </Canvas>
</div>

<style>
  .cloud-canvas-wrapper {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }

  .cloud-canvas-wrapper :global(canvas) {
    width: 100% !important;
    height: 100% !important;
  }
</style>
```

**Step 2: Verify types**

Run: `npx svelte-check --tsconfig ./tsconfig.json`
Expected: May show errors about VolumetricClouds.svelte not existing yet — that's Task 5.

**Step 3: Commit (after Task 5 passes type check)**

---

## Task 5: VolumetricClouds Threlte Component

**Files:**
- Create: `src/lib/layers/VolumetricClouds.svelte`

This is the inner Threlte scene component that creates the fullscreen quad mesh with the cloud shader material.

**Step 1: Create VolumetricClouds.svelte**

```svelte
<script lang="ts">
  /**
   * VolumetricClouds - Threlte scene component
   *
   * Creates a fullscreen quad with the FBM raymarching cloud shader.
   * Must be placed inside a Threlte <Canvas>.
   */
  import { T, useThrelte } from '@threlte/core';
  import * as THREE from 'three';
  import { CLOUD_VERTEX, CLOUD_FRAGMENT } from './cloud-shader';

  interface Props {
    density?: number;
    cloudSpeed?: number;
    nightFactor?: number;
    dawnDuskFactor?: number;
    skyState?: 'day' | 'night' | 'dawn' | 'dusk';
    time?: number;
  }

  let {
    density = 0.5,
    cloudSpeed = 1.0,
    nightFactor = 0,
    dawnDuskFactor = 0,
    skyState = 'day',
    time = 0,
  }: Props = $props();

  const { size, advance } = useThrelte();

  // Sun position derived from sky state
  const sunPosition = $derived.by(() => {
    switch (skyState) {
      case 'dawn': return new THREE.Vector3(-1.0, 0.5, 1.0);
      case 'dusk': return new THREE.Vector3(1.0, 0.3, -1.0);
      case 'night': return new THREE.Vector3(0.0, -1.0, 0.0);
      default: return new THREE.Vector3(1.0, 2.0, 1.0);
    }
  });

  // Cloud color: white during day, blue-gray at night, warm at dawn/dusk
  const cloudColor = $derived.by(() => {
    if (nightFactor > 0.7) return new THREE.Color(0.3, 0.35, 0.5);
    if (dawnDuskFactor > 0.3) return new THREE.Color(0.92, 0.75, 0.42);
    return new THREE.Color(0.92, 0.92, 0.95);
  });

  // Sky color for scattering through clouds
  const skyColor = $derived.by(() => {
    if (nightFactor > 0.7) return new THREE.Color(0.04, 0.04, 0.08);
    if (dawnDuskFactor > 0.3) return new THREE.Color(0.6, 0.4, 0.2);
    return new THREE.Color(0.2, 0.47, 1.0);
  });

  // Cloud steps: reduce for performance. 24 is a good balance.
  const cloudSteps = $derived(nightFactor > 0.7 ? 16 : 24);

  // Shader material
  const material = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uCloudSize: { value: new THREE.Vector3(0.5, 1.0, 0.5) },
      uSunPosition: { value: sunPosition },
      uCameraPosition: { value: new THREE.Vector3(8.0, -5.5, 8.0) },
      uCloudColor: { value: cloudColor },
      uSkyColor: { value: skyColor },
      uCloudSteps: { value: cloudSteps },
      uShadowSteps: { value: 4 },
      uCloudLength: { value: 16 },
      uShadowLength: { value: 2 },
      uResolution: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uFocalLength: { value: 2.0 },
      uDensity: { value: density },
    },
  });

  // Sync uniforms reactively
  $effect(() => {
    material.uniforms.uDensity.value = density;
    material.uniforms.uCloudSteps.value = cloudSteps;
    material.uniforms.uSunPosition.value.copy(sunPosition);
    material.uniforms.uCloudColor.value.copy(cloudColor);
    material.uniforms.uSkyColor.value.copy(skyColor);
    material.uniforms.uTime.value = time * cloudSpeed;
    material.uniforms.uResolution.value.set(
      $size.width * window.devicePixelRatio,
      $size.height * window.devicePixelRatio,
    );
    // Trigger re-render after uniform update
    advance();
  });

  // Fullscreen quad geometry (clip space -1 to 1)
  const geometry = new THREE.PlaneGeometry(2, 2);
</script>

<T.Mesh {geometry} {material} frustumCulled={false} />
```

**Step 2: Verify types**

Run: `npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors. The Threlte `T.Mesh` component accepts geometry and material props.

**Step 3: Commit both components**

```bash
git add src/lib/layers/CloudCanvas.svelte src/lib/layers/VolumetricClouds.svelte
git commit -m "feat: add Threlte volumetric cloud canvas and scene components"
```

---

## Task 6: Integrate CloudCanvas into Window.svelte

**Files:**
- Modify: `src/lib/layers/Window.svelte:1-25` (imports)
- Modify: `src/lib/layers/Window.svelte:31-56` (RAF loop)
- Modify: `src/lib/layers/Window.svelte:123-127` (cloud derived values — remove)
- Modify: `src/lib/layers/Window.svelte:289-302` (template — replace CSS clouds)
- Modify: `src/lib/layers/Window.svelte:595-734` (styles — remove CSS cloud styles)

**Step 1: Add import**

At `Window.svelte:24`, after the `CesiumViewer` import, add:

```typescript
import CloudCanvas from './CloudCanvas.svelte';
```

**Step 2: Add elapsed time tracker to RAF loop**

In the RAF `$effect` at `Window.svelte:31-56`, add a reactive elapsed time for the cloud shader. Add before the loop function:

```typescript
let elapsedTime = $state(0);
```

Inside the `try` block of the loop function (after `model.tick(dt)` at line 40), add:

```typescript
elapsedTime += dt;
```

**Step 3: Replace CSS cloud template with CloudCanvas**

Replace lines 289-302 (the `<!-- z:1 — Clouds -->` block):

```svelte
{#if cloudOpacity > 0.01}
  <div
    class="cloud-container"
    class:night={isNight}
    style:z-index={1}
    style:opacity={cloudOpacity}
    style:--cloud-speed={cloudSpeed}
  >
    <div class="cloud-layer near"></div>
    <div class="cloud-layer mid"></div>
    <div class="cloud-layer far"></div>
  </div>
{/if}
```

With:

```svelte
<!-- z:1 — Volumetric clouds (Threlte WebGL overlay) -->
<div class="render-layer" style:z-index={1} style:opacity={cloudOpacity}>
  <CloudCanvas
    density={cloudOpacity}
    cloudSpeed={cloudSpeed}
    nightFactor={model.nightFactor}
    dawnDuskFactor={model.dawnDuskFactor}
    skyState={model.skyState}
    time={elapsedTime}
  />
</div>
```

**Step 4: Remove CSS cloud styles**

Delete the entire cloud CSS section from `<style>` — lines 595-734 (from `/* --- Clouds (inlined from CloudLayer) --- */` through the `cloud-drift-far` keyframe).

**Step 5: Update component docblock**

Update the comment at lines 2-16 to reflect the new cloud layer:

```
 * Z-order:
 *   0: Cesium (terrain, buildings, NASA night lights, CartoDB roads)
 *   1: Clouds (Threlte volumetric raymarching)
 *   2: Weather (CSS rain + lightning)
```

**Step 6: Verify**

Run: `npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors

Run: `npm run dev`
Expected: Dev server starts. Navigate to `/` — clouds render as volumetric 3D volumes over Cesium terrain. Clouds respond to time of day (color shifts at dawn/dusk/night).

**Step 7: Commit**

```bash
git add src/lib/layers/Window.svelte
git commit -m "feat: replace CSS clouds with Threlte volumetric cloud overlay"
```

---

## Task 7: Architecture Page — Live CSS Layer Previews

**Files:**
- Modify: `src/routes/architecture/+page.svelte`

This is the largest task. We add a `preview` field to each layer definition containing a Svelte snippet ID, then render self-contained CSS animation previews inside each expanded layer bar.

**Step 1: Add preview type to Layer interface**

In the `<script>` section, update the `Layer` interface to include a `previewType`:

```typescript
interface Layer {
  id: string;
  name: string;
  z: string;
  condition: string;
  description: string;
  category: 'glass' | 'css' | 'gpu' | 'imagery';
  details: string[];
  previewType: 'css' | 'shader' | 'imagery' | 'cloud';
}
```

Add `previewType` to every layer object in the `layers` array:
- `glass-frame`: `previewType: 'css'`
- `vignette`: `previewType: 'css'`
- `glass-surface`: `previewType: 'css'`
- `wing`: `previewType: 'css'`
- `frost`: `previewType: 'css'`
- `micro-events`: `previewType: 'css'`
- `weather`: `previewType: 'css'`
- `clouds`: `previewType: 'cloud'`
- `bloom`: `previewType: 'shader'`
- `color-grading`: `previewType: 'shader'`
- `fxaa`: `previewType: 'shader'`
- `viirs`: `previewType: 'imagery'`
- `roads`: `previewType: 'imagery'`
- `esri`: `previewType: 'imagery'`

**Step 2: Add preview markup inside the expanded layer details**

Inside the `{#if expandedLayer === layer.id}` block, after the detail lines, add preview elements using `{#if}` blocks keyed on `layer.id`. Each preview is a 100%-width, 150px-tall self-contained CSS animation.

Add this after the `{#each layer.details}` block:

```svelte
<div class="layer-preview">
  {#if layer.id === 'glass-frame'}
    <div class="preview-glass-frame">
      <div class="preview-inner"></div>
    </div>
  {:else if layer.id === 'vignette'}
    <div class="preview-vignette"></div>
  {:else if layer.id === 'glass-surface'}
    <div class="preview-glass-surface"></div>
  {:else if layer.id === 'wing'}
    <div class="preview-wing">
      <div class="preview-wing-shape"></div>
    </div>
  {:else if layer.id === 'frost'}
    <div class="preview-frost"></div>
  {:else if layer.id === 'micro-events'}
    <div class="preview-micro">
      <div class="preview-star"></div>
    </div>
  {:else if layer.id === 'weather'}
    <div class="preview-weather">
      <div class="preview-rain-near"></div>
      <div class="preview-rain-far"></div>
      <div class="preview-lightning"></div>
    </div>
  {:else if layer.id === 'clouds'}
    <div class="preview-clouds">
      <div class="preview-cloud near"></div>
      <div class="preview-cloud mid"></div>
      <div class="preview-cloud far"></div>
    </div>
  {:else if layer.id === 'color-grading'}
    <div class="preview-color-grading">
      <div class="preview-cg-before"></div>
      <div class="preview-cg-arrow">→</div>
      <div class="preview-cg-after"></div>
    </div>
  {:else if layer.id === 'bloom'}
    <div class="preview-bloom">
      <div class="preview-bloom-dot"></div>
    </div>
  {:else if layer.id === 'viirs' || layer.id === 'roads' || layer.id === 'esri'}
    <div class="preview-imagery">
      <div class="preview-imagery-label">{layer.name}</div>
    </div>
  {/if}
</div>
```

**Step 3: Add preview CSS styles**

Add to the `<style>` block. These are all self-contained CSS animations that replicate each layer's visual effect in a 150px preview box:

```css
/* ================================================================ */
/* LAYER PREVIEWS */
/* ================================================================ */

.layer-preview {
  margin-top: 0.6rem;
  height: 150px;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
  background: #0d0d20;
}

/* Glass frame preview */
.preview-glass-frame {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-glass-frame .preview-inner {
  width: 60%;
  height: 75%;
  border-radius: 40%;
  background: linear-gradient(180deg, #4a7ab5 0%, #8cb8e0 100%);
  box-shadow:
    inset 0 0 10px 4px rgba(0, 0, 0, 0.25),
    inset 2px 2px 6px rgba(0, 0, 0, 0.15);
}

/* Vignette preview */
.preview-vignette {
  position: absolute;
  inset: 0;
  background: #4a7ab5;
}

.preview-vignette::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 75% 65% at 50% 50%,
    transparent 55%,
    rgba(0, 0, 0, 0.08) 80%,
    rgba(0, 0, 0, 0.5) 100%
  );
}

/* Glass surface preview */
.preview-glass-surface {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #1a1a3a 0%, #0d0d20 100%);
}

.preview-glass-surface::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at center,
    transparent 50%,
    rgba(0, 0, 0, 0.6) 100%
  );
  animation: preview-pulse 3s ease-in-out infinite alternate;
}

/* Wing preview */
.preview-wing {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #4a7ab5 0%, #8cb8e0 100%);
}

.preview-wing-shape {
  position: absolute;
  bottom: -5%;
  left: -15%;
  width: 75%;
  height: 35%;
  background: linear-gradient(
    25deg,
    rgba(20, 20, 25, 0.7) 0%,
    rgba(30, 30, 35, 0.5) 20%,
    rgba(40, 40, 50, 0.25) 40%,
    transparent 60%
  );
  animation: preview-bank 6s ease-in-out infinite alternate;
  transform-origin: 80% 100%;
}

/* Frost preview */
.preview-frost {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #4a7ab5 0%, #8cb8e0 100%);
}

.preview-frost::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 100% 100% at 50% 50%,
    transparent 40%,
    rgba(200, 220, 255, 0.4) 70%,
    rgba(180, 200, 255, 0.6) 90%
  );
  animation: preview-frost-breathe 8s ease-in-out infinite alternate;
}

/* Micro-events preview */
.preview-micro {
  position: absolute;
  inset: 0;
  background: #0d0d20;
}

.preview-star {
  position: absolute;
  top: 20%;
  left: 30%;
  width: 2px;
  height: 60px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.9) 0%,
    rgba(200, 220, 255, 0.5) 40%,
    transparent 100%
  );
  transform: rotate(-35deg);
  animation: preview-shoot 3s linear infinite;
}

/* Weather preview */
.preview-weather {
  position: absolute;
  inset: 0;
  background: #2a2a40;
  overflow: hidden;
}

.preview-rain-near,
.preview-rain-far {
  position: absolute;
  inset: -50%;
  background: repeating-linear-gradient(
    86deg,
    transparent 0px,
    transparent 4px,
    rgba(180, 200, 255, 0.3) 4px,
    rgba(180, 200, 255, 0.3) 5px
  );
}

.preview-rain-near {
  background-size: 100% 80px;
  animation: preview-rain 0.4s linear infinite;
}

.preview-rain-far {
  background-size: 100% 50px;
  opacity: 0.5;
  animation: preview-rain 0.6s linear infinite;
}

.preview-lightning {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 60% 50% at 40% 30%,
    rgba(200, 200, 255, 0.8) 0%,
    transparent 60%
  );
  mix-blend-mode: screen;
  animation: preview-flash 4s ease-in-out infinite;
}

/* Cloud preview (CSS version for architecture page) */
.preview-clouds {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #4a7ab5 0%, #8cb8e0 100%);
}

.preview-cloud {
  position: absolute;
  inset: -20%;
  border-radius: 50%;
}

.preview-cloud.near {
  background: radial-gradient(
    ellipse 45% 30% at 25% 40%,
    rgba(255, 255, 255, 0.6) 0%,
    transparent 70%
  );
  filter: blur(8px);
  animation: preview-cloud-drift 6s linear infinite alternate;
}

.preview-cloud.mid {
  background: radial-gradient(
    ellipse 40% 28% at 60% 55%,
    rgba(240, 245, 255, 0.4) 0%,
    transparent 65%
  );
  filter: blur(12px);
  animation: preview-cloud-drift 8s linear infinite alternate-reverse;
}

.preview-cloud.far {
  background: radial-gradient(
    ellipse 55% 35% at 45% 50%,
    rgba(230, 240, 255, 0.25) 0%,
    transparent 60%
  );
  filter: blur(16px);
  animation: preview-cloud-drift 10s linear infinite alternate;
}

/* Color grading preview */
.preview-color-grading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.preview-cg-before,
.preview-cg-after {
  width: 40%;
  height: 80%;
  border-radius: 4px;
}

.preview-cg-before {
  /* Grayscale terrain at night — before shader */
  background: linear-gradient(135deg, #333 0%, #555 40%, #222 60%, #444 100%);
}

.preview-cg-after {
  /* After sodium vapor palette — warm city glow */
  background: linear-gradient(135deg, #000 0%, #ffa040 30%, #000 50%, #ffcc66 80%, #000 100%);
  box-shadow: 0 0 20px rgba(255, 160, 64, 0.3);
}

.preview-cg-arrow {
  color: rgba(255, 255, 255, 0.3);
  font-size: 1.5rem;
}

/* Bloom preview */
.preview-bloom {
  position: absolute;
  inset: 0;
  background: #050508;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-bloom-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffa040;
  box-shadow:
    0 0 10px #ffa040,
    0 0 30px rgba(255, 160, 64, 0.5),
    0 0 60px rgba(255, 160, 64, 0.3);
  animation: preview-bloom-pulse 3s ease-in-out infinite alternate;
}

/* Imagery placeholder preview */
.preview-imagery {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #1a2a4a 0%, #0a1a2a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-imagery-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.25);
  border: 1px dashed rgba(255, 255, 255, 0.1);
  padding: 0.5rem 1rem;
  border-radius: 4px;
}

/* Preview animations */
@keyframes preview-pulse {
  from { opacity: 0.2; }
  to { opacity: 0.4; }
}

@keyframes preview-bank {
  from { transform: rotate(-2deg); }
  to { transform: rotate(2deg); }
}

@keyframes preview-frost-breathe {
  from { opacity: 0.6; }
  to { opacity: 1; }
}

@keyframes preview-shoot {
  0% { transform: rotate(-35deg) translate(0, 0); opacity: 1; }
  30% { opacity: 0; }
  100% { transform: rotate(-35deg) translate(80px, 140px); opacity: 0; }
}

@keyframes preview-rain {
  from { transform: translate3d(0, -80px, 0); }
  to { transform: translate3d(0, 0, 0); }
}

@keyframes preview-flash {
  0%, 85%, 100% { opacity: 0; }
  88% { opacity: 0.8; }
  91% { opacity: 0; }
  93% { opacity: 0.4; }
}

@keyframes preview-cloud-drift {
  from { transform: translateX(-5%); }
  to { transform: translateX(5%); }
}

@keyframes preview-bloom-pulse {
  from { box-shadow: 0 0 10px #ffa040, 0 0 30px rgba(255, 160, 64, 0.5), 0 0 60px rgba(255, 160, 64, 0.3); }
  to { box-shadow: 0 0 15px #ffa040, 0 0 40px rgba(255, 160, 64, 0.6), 0 0 80px rgba(255, 160, 64, 0.4); }
}
```

**Step 4: Verify**

Run: `npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors

Run: `npm run dev` → navigate to `/architecture`
Expected: Clicking any layer shows the detail text AND a 150px animated preview box beneath it.

**Step 5: Commit**

```bash
git add src/routes/architecture/+page.svelte
git commit -m "feat: add live CSS layer previews to architecture page"
```

---

## Task 8: Final Verification + Polish

**Files:**
- Review all modified files

**Step 1: Full type check**

Run: `npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors, pre-existing a11y warning only.

**Step 2: Production build**

Run: `npm run build`
Expected: Build succeeds. Output shows `cesium-*.js` and `three-*.js` chunks. No new warnings.

**Step 3: Visual verification**

Run: `npm run dev`

1. Navigate to `/` — volumetric clouds render over Cesium terrain at z:1
2. Clouds change color at night (blue-gray), dawn/dusk (warm amber)
3. Cloud density responds to weather settings in SidePanel
4. Click the window — flyTo works, clouds persist across transitions
5. Blind closes/opens — clouds visible through the blind gap
6. No favicon 404 in terminal
7. Navigate to `/architecture` — all layer previews render and animate
8. Back link (`←`) navigates to `/`

**Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: volumetric clouds, architecture previews, favicon"
```

---

## Summary

| Task | Files | Commit Message |
|------|-------|---------------|
| 1 | `static/favicon.svg`, `src/app.html` | `fix: add favicon to resolve 404` |
| 2 | `package.json`, `vite.config.ts` | `chore: add threlte and three.js dependencies` |
| 3 | `src/lib/layers/cloud-shader.ts` | `feat: add volumetric cloud FBM raymarching shader` |
| 4+5 | `src/lib/layers/CloudCanvas.svelte`, `VolumetricClouds.svelte` | `feat: add Threlte volumetric cloud components` |
| 6 | `src/lib/layers/Window.svelte` | `feat: replace CSS clouds with Threlte volumetric cloud overlay` |
| 7 | `src/routes/architecture/+page.svelte` | `feat: add live CSS layer previews to architecture page` |
| 8 | all | `feat: volumetric clouds, architecture previews, favicon` |
