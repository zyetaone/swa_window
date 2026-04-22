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

// Sample the water normal map twice with different UV speeds and sum.
// Identical technique to three.js Water.js and Cesium prod — two layers
// scrolling in orthogonal directions create a non-repeating wave feel.
vec3 sampleWaterNormal(vec2 uv, float t) {
	// Tile the 512-ish normal map many times across the viewport. The UV
	// multiplier sets wave density — too low and waves are giant and
	// planar, too high and they alias into noise.
	vec2 uvA = uv * 12.0 + vec2( 0.05,  0.03) * t;
	vec2 uvB = uv *  9.0 + vec2(-0.02,  0.04) * t;

	vec3 nA = texture2D(tWaterNormals, uvA).rgb * 2.0 - 1.0;
	vec3 nB = texture2D(tWaterNormals, uvB).rgb * 2.0 - 1.0;

	// Sum and re-normalize. Because we're in screen-space (not tangent-
	// space), treat XY as screen-plane offsets and Z as up-from-plane.
	return normalize(nA + nB);
}

void main() {
	vec4 frame = texture2D(tDiffuse, vUv);
	vec3 rgb   = frame.rgb;

	// ── Water mask via chroma-key ─────────────────────────────────────
	// Euclidean RGB distance from the known water base color. Works
	// because MapLibre paints water as a flat fill; our color-grade
	// pass runs BEFORE this, but the grade's nightfactor/pollution
	// shifts are luminance-based and don't move water far from base
	// at the distances we tolerate.
	float d = distance(rgb, u_waterBase);
	// Smooth edge — hard cutoff would shimmer against anti-aliased
	// coastlines; feathered edge blends into land gracefully.
	float mask = 1.0 - smoothstep(u_waterKeyTolerance * 0.6, u_waterKeyTolerance, d);

	// Early-out: nothing to do. Keeping the branch short (1 texture
	// read + 1 distance) keeps non-water pixels cheap.
	if (mask < 0.01 || u_waterIntensity < 0.01) {
		gl_FragColor = frame;
		return;
	}

	// ── Scrolling normal map ──────────────────────────────────────────
	vec3 n = sampleWaterNormal(vUv, u_time);

	// ── Fresnel ───────────────────────────────────────────────────────
	// In screen-space with viewDir = (0,0,1), fresnel reduces to
	// pow(1 - n.z, 5). Wave facets tipped toward camera (n.z ≈ 1) give
	// low fresnel (you see into the water); facets tipped sideways
	// (n.z low) give high fresnel (you see sky reflection).
	float fresnel = pow(clamp(1.0 - n.z, 0.0, 1.0), 5.0);

	// ── Sun specular ──────────────────────────────────────────────────
	// Reflect the sun direction about the surface normal and check how
	// close it is to the camera axis. Large exponent = tight highlight.
	// Below-horizon sun (z < 0) is zero-clamped by the max() below.
	vec3 sunDir = normalize(u_sunDirScreen + vec3(1e-5));
	vec3 reflected = reflect(-sunDir, n);
	float specAngle = max(reflected.z, 0.0);
	float specular = pow(specAngle, 64.0);
	// Fade specular as sun dips — elevation factor is u_sunDirScreen.z.
	float sunAlt = clamp(u_sunDirScreen.z, 0.0, 1.0);
	// Boost specular during dawn/dusk — that's when hot coin-glints on
	// water read most strongly in real photos.
	specular *= sunAlt * (1.0 + u_dawnDuskFactor * 0.8);

	// ── Compose water look ────────────────────────────────────────────
	// Base water color: original MapLibre fill (already animated by the
	// water-anim palette + shimmer), darkened slightly so reflections
	// pop on top.
	vec3 waterBase = rgb * 0.85;

	// Sky reflection scaled by fresnel — water is a mirror at grazing
	// angles. At night, skyReflection is navy/black so this dims water
	// naturally without a separate night branch.
	vec3 reflectionTerm = u_skyReflection * fresnel;

	// Sun specular — hot during day, gated off at night.
	vec3 specularTerm = u_sunColor * specular * (1.0 - u_nightFactor * 0.9);

	vec3 water = waterBase + reflectionTerm + specularTerm;

	// At night, keep water dark + gently reflect sky-phase color. Hot
	// specular is muted above; fresnel-driven sky reflection gives the
	// subtle city/moon glitter that reads as "nighttime water" to the
	// eye.
	water = mix(water, waterBase + u_skyReflection * fresnel * 0.6,
	            u_nightFactor * 0.65);

	// Mask-blend with intensity gate so we can crossfade the effect in.
	float alpha = mask * u_waterIntensity;
	rgb = mix(rgb, water, alpha);

	gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), frame.a);
}
