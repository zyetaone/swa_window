// water.glsl — animated water post-process fragment shader.
//
// Ported in spirit from Cesium prod's water technique (scrolling normal
// map + Fresnel + sun specular). Because we're running in screen-space
// on an already-composited MapLibre frame (not a 3D water plane), the
// math is simplified:
//
//   - viewDir is assumed vec3(0, 0, 1) (camera-aligned screen-space)
//   - sun direction is provided in screen-space
//   - water mask comes from chroma-key against the palette's water RGB
//     (Strategy C — see PostProcessMount comment for rationale)
//
// Runs AFTER UnrealBloom, BEFORE OutputPass. This order is deliberate:
// bloom widens city light halos first, then water re-paint overrides
// those pixels (so bloom from a coastline doesn't bleed into the water
// re-paint and turn it into a smear). Where the mask is 0 the pixel is
// returned untouched.
//
// Reference normal map: waterNormalsSmall.jpg from Cesium (Apache 2.0).
// See /static/textures/water-normals.jpg.
precision highp float;

uniform sampler2D tDiffuse;
uniform sampler2D tWaterNormals;

// Target water palette RGB (0-1) — matches the fill-color MapLibre paints.
uniform vec3  u_waterBase;

// Chroma-key tolerance (0..1) — RGB Euclidean distance threshold.
uniform float u_waterKeyTolerance;

// Sun direction in screen-space. x/y = projection of sun onto screen
// (normalised so length <= 1; center = straight behind camera), z =
// altitude factor (1 = overhead, 0 = horizon, <0 = below horizon).
uniform vec3  u_sunDirScreen;
uniform vec3  u_sunColor;

// Sky reflection color — what the water reflects back at the camera
// from its fresnel-lit facets. Fed from sky-phase palette.
uniform vec3  u_skyReflection;

uniform float u_nightFactor;      // 0 = day, 1 = night
uniform float u_dawnDuskFactor;   // 0..1 peak at mid-transition
uniform float u_waterIntensity;   // 0 = pass-through, 1 = full effect
uniform float u_time;             // seconds, monotonic

varying vec2 vUv;

// Multi-scale scrolling normals with distance-aware tiling.
//
// At altitude, real ocean reads VERY different near vs far:
//   - near  (bottom of frame): individual wave facets, sharp crinkles
//   - mid:                     coarser wavelets, coin-glint specular
//   - far   (near horizon):    smooth mirror, specular dominates
//
// We approximate "distance" via screen Y (horizon ≈ 0.4 from bottom).
// Three normal-map samples at different UV scales are weighted by
// distance: far pixels see only the large-scale sample (slow, calm),
// near pixels see all three summed (busy crinkles). This is the
// "tile the water — calmer further away" pattern — each scale is a
// tile size; nearer distance = more tile sizes active.
//
// Scroll speeds are paired with their scale — large waves drift slow,
// small waves scurry fast, like real surface dynamics.
vec3 sampleWaterNormal(vec2 uv, float t, float distFade) {
	// Large-scale swell — always present, drives the specular glint lines
	// at the horizon. Slow drift so it doesn't feel noisy at distance.
	vec2 uvFar  = uv * 3.5  + vec2( 0.012,  0.007) * t;
	vec3 nFar   = texture2D(tWaterNormals, uvFar).rgb  * 2.0 - 1.0;

	// Mid-scale wavelets — the "ocean texture" at cruise altitude.
	vec2 uvMid  = uv * 8.0  + vec2(-0.028,  0.018) * t;
	vec3 nMid   = texture2D(tWaterNormals, uvMid).rgb  * 2.0 - 1.0;

	// Near-scale facets — only visible when the camera is low, which in
	// screen-space means bottom of frame. Scrolls fastest.
	vec2 uvNear = uv * 18.0 + vec2( 0.045, -0.035) * t;
	vec3 nNear  = texture2D(tWaterNormals, uvNear).rgb * 2.0 - 1.0;

	// Distance weighting. distFade = 0 at horizon, 1 at bottom of frame.
	// Far pixels get only the slow swell. Near pixels sum all three.
	float wMid  = smoothstep(0.15, 0.55, distFade);
	float wNear = smoothstep(0.45, 0.90, distFade);

	vec3 n = nFar + nMid * wMid + nNear * wNear;

	// Flatten the normal toward straight-up (0,0,1). Real ocean at
	// altitude reads more as a reflective plane than a faceted surface —
	// we keep the normals SMALL so the effect is a subtle shimmer, not
	// a visible wave texture. Near the horizon we flatten almost to a
	// mirror; near the camera we allow ~15% facet angle max.
	float flatten = mix(0.05, 0.18, distFade);
	n = mix(vec3(0.0, 0.0, 1.0), n, flatten);

	return normalize(n + vec3(1e-5));
}

void main() {
	vec4 frame = texture2D(tDiffuse, vUv);
	vec3 rgb   = frame.rgb;

	// ── Horizon gate ──────────────────────────────────────────────────
	// Water physically cannot appear above the horizon from an airplane
	// view. Sky can have RGB near the palette water color (both are
	// blue-family); without this gate the chroma-key matches sky pixels
	// and paints them with wave normals.
	//
	// Empirically in our RenderPass pipeline, vUv.y = 1 at the TOP of
	// the frame and 0 at the BOTTOM. Horizon sits around vUv.y ≈ 0.45.
	// Water is below horizon, i.e. vUv.y < 0.45. Soft taper avoids
	// popping coastlines.
	float horizonGate = 1.0 - smoothstep(0.38, 0.52, vUv.y);

	// ── Water mask via chroma-key ─────────────────────────────────────
	// Euclidean RGB distance from the known water base color. Works
	// because MapLibre paints water as a flat fill; our color-grade
	// pass runs BEFORE this, but the grade's nightfactor/pollution
	// shifts are luminance-based and don't move water far from base
	// at the distances we tolerate.
	float d = distance(rgb, u_waterBase);
	// Smooth edge — hard cutoff would shimmer against anti-aliased
	// coastlines; feathered edge blends into land gracefully.
	float chromaMask = 1.0 - smoothstep(u_waterKeyTolerance * 0.6, u_waterKeyTolerance, d);
	float mask = chromaMask * horizonGate;

	// ── Shoreline ripple boost ────────────────────────────────────────
	// Beach + shallow water reads with more wave action than open ocean
	// in reality. The chroma-mask transition is a free coastline proxy —
	// fragments where the mask is mid-value (0.35–0.75) are near the
	// water-land boundary. Boost normal-map contribution there so the
	// shoreline shimmers with extra micro-movement.
	float shoreBoost = 1.0 - 4.0 * abs(chromaMask - 0.55);
	shoreBoost = clamp(shoreBoost, 0.0, 1.0) * horizonGate;

	// Early-out: nothing to do. Keeping the branch short (1 texture
	// read + 1 distance) keeps non-water pixels cheap.
	if (mask < 0.01 || u_waterIntensity < 0.01) {
		gl_FragColor = frame;
		return;
	}

	// ── Distance proxy ────────────────────────────────────────────────
	// With vUv.y = 1 at top of frame and 0 at bottom (empirically —
	// RenderPass + flipY interact to give this convention), horizon
	// sits around 0.45 and closest water is at the bottom. distFade = 0
	// at horizon (far / calm) and 1 at bottom (near / crinkled).
	float distFade = 1.0 - clamp(vUv.y / 0.45, 0.0, 1.0);

	// ── Scrolling normal map (tiled, distance-aware) ──────────────────
	// Boost the effective "nearness" along the shore so shallow-water
	// readings get more small-scale ripple energy. Shore pixels use
	// clamp(distFade + 0.35*shoreBoost, 0, 1) — adds up to 35% near
	// the coastline. Plus an extra small-scale scroll sample mixed in
	// ONLY where shoreBoost is strong, for that "lapping waves" feel.
	float shoreDistFade = clamp(distFade + 0.35 * shoreBoost, 0.0, 1.0);
	vec3 n = sampleWaterNormal(vUv, u_time, shoreDistFade);

	// Shoreline micro-ripple — extra-fast scroll, tiny amplitude, only
	// near the mask transition. Gives beaches the "slight movement /
	// rippled / waves" feel without adding noise to open water.
	if (shoreBoost > 0.05) {
		vec2 uvRipple = vUv * 36.0 + vec2(0.18, -0.12) * u_time;
		vec3 nRipple = texture2D(tWaterNormals, uvRipple).rgb * 2.0 - 1.0;
		n = normalize(n + nRipple * 0.15 * shoreBoost);
	}

	// ── Fresnel ───────────────────────────────────────────────────────
	// In screen-space with viewDir = (0,0,1), fresnel reduces to
	// pow(1 - n.z, 5). Wave facets tipped toward camera (n.z ≈ 1) give
	// low fresnel (you see into the water); facets tipped sideways
	// (n.z low) give high fresnel (you see sky reflection).
	// At distance the normal is flattened, so fresnel naturally drops
	// to a soft sheen — no extra math needed.
	float fresnel = pow(clamp(1.0 - n.z, 0.0, 1.0), 5.0);

	// ── Sun specular ──────────────────────────────────────────────────
	// Reflect the sun direction about the surface normal and check how
	// close it is to the camera axis. Large exponent = tight highlight.
	vec3 sunDir = normalize(u_sunDirScreen + vec3(1e-5));
	vec3 reflected = reflect(-sunDir, n);
	float specAngle = max(reflected.z, 0.0);
	// Tighter exponent (160 vs 64) at distance — real ocean specular is
	// a thin bright line at the horizon, not a broad smear. Broader
	// exponent near the camera so crinkled water sparkles.
	float specExp = mix(64.0, 160.0, 1.0 - distFade);
	float specular = pow(specAngle, specExp);
	// Fade specular as sun dips — elevation factor is u_sunDirScreen.z.
	float sunAlt = clamp(u_sunDirScreen.z, 0.0, 1.0);
	// Distant water gets boosted specular (it's the dominant read — no
	// crinkle detail to compete). Near water's specular is tempered so
	// the normal-map facets do the texture work.
	float specDistBoost = mix(0.85, 1.7, 1.0 - distFade);
	// Boost specular during dawn/dusk — that's when hot coin-glints on
	// water read most strongly in real photos.
	specular *= sunAlt * specDistBoost * (1.0 + u_dawnDuskFactor * 0.8);

	// ── Compose water look ────────────────────────────────────────────
	// Base water: keep the MapLibre fill nearly intact (0.95 vs prior
	// 0.85) so land→water transition is smooth and water isn't visibly
	// darker than its palette value.
	vec3 waterBase = rgb * 0.95;

	// Sky reflection scaled by fresnel + 0.35 damping — we want water
	// to FEEL reflective, not become a mirror. Reduced from full to
	// avoid the "glass plate" look that was reading as fake.
	vec3 reflectionTerm = u_skyReflection * fresnel * 0.35;

	// Sun specular — hot during day, gated off at night. Halved so
	// daytime ocean has a single coin-glint, not a broad sheen.
	vec3 specularTerm = u_sunColor * specular * 0.5 * (1.0 - u_nightFactor * 0.9);

	vec3 water = waterBase + reflectionTerm + specularTerm;

	// At night, water is near-black with a faint sky-reflection hint —
	// hot specular muted above; fresnel reflection even more damped.
	water = mix(water, waterBase + u_skyReflection * fresnel * 0.20,
	            u_nightFactor * 0.65);

	// Mask-blend with intensity gate so we can crossfade the effect in.
	float alpha = mask * u_waterIntensity;
	rgb = mix(rgb, water, alpha);

	gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), frame.a);
}
