/**
 * Procedural Cloud Shaders — Airplane Window View
 *
 * Camera-driven parallax clouds: UV offsets respond to heading/pitch so
 * clouds shift as the plane turns, creating a 3D depth illusion.
 *
 * Three layers at different parallax depths:
 *   - Far layer:  large cirrus sheets, barely shifts with camera (distant)
 *   - Mid layer:  cumulus formations, moderate parallax
 *   - Near layer: fast wisps, strong parallax (close to window)
 *
 * Each layer uses 3-octave FBM noise. The parallax multiplier per layer
 * makes near clouds appear closer by shifting more when the camera moves.
 * GPU cost: ~9 noise evaluations per pixel (3 octaves × 3 layers).
 * Output: premultiplied alpha for transparent compositing over Cesium.
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

	uniform vec3  uCloudColor;    // main cloud tint (circadian)
	uniform vec3  uSkyColor;      // sky scattering color
	uniform vec3  uSunDirection;  // normalized sun direction
	uniform float uTime;          // elapsed time (animated)
	uniform float uDensity;       // cloud density multiplier (0-1)
	uniform float uWindSpeed;     // wind drift speed
	uniform vec2  uResolution;    // viewport size in pixels
	uniform float uHeading;       // camera heading in radians
	uniform float uPitch;         // camera pitch offset in radians
	uniform float uAltitude;      // aircraft altitude in feet

	varying vec2 vUv;

	// --- Rotation matrix between FBM octaves ---
	// Prevents axis-aligned banding artifacts
	mat3 m = mat3(
		 0.00,  0.80,  0.60,
		-0.80,  0.36, -0.48,
		-0.60, -0.48,  0.64
	);

	// --- Hash function for pseudo-random noise ---
	float hash(float n) {
		return fract(sin(n) * 43758.5453);
	}

	// --- 3D value noise via trilinear interpolation ---
	float noise(vec3 x) {
		vec3 p = floor(x);
		vec3 f = fract(x);
		f = f * f * (3.0 - 2.0 * f);

		float n = p.x + p.y * 57.0 + 113.0 * p.z;

		return mix(
			mix(
				mix(hash(n),         hash(n + 1.0),   f.x),
				mix(hash(n + 57.0),  hash(n + 58.0),  f.x),
				f.y
			),
			mix(
				mix(hash(n + 113.0), hash(n + 114.0), f.x),
				mix(hash(n + 170.0), hash(n + 171.0), f.x),
				f.y
			),
			f.z
		);
	}

	// --- 3-octave FBM ---
	float fbm(vec3 p) {
		float f = 0.0;
		f += 0.5000 * noise(p); p = m * p * 2.02;
		f += 0.2500 * noise(p); p = m * p * 2.03;
		f += 0.1250 * noise(p);
		return f / 0.875;
	}

	// --- Cloud layer with camera-driven parallax ---
	// parallax: how much this layer shifts with camera (0 = locked to sky, 1 = stuck to window)
	float cloudLayer(vec2 uv, float scale, float speed, float zLayer, float threshold, float parallax) {
		// Camera parallax: heading shifts horizontally, pitch shifts vertically.
		// Each layer shifts proportional to its parallax depth.
		vec2 cameraOffset = vec2(
			uHeading * parallax,
			uPitch * parallax * 0.5
		);

		vec3 p = vec3((uv + cameraOffset) * scale, zLayer + uTime * 0.005);
		p.x += uTime * speed * uWindSpeed;
		p.y += uTime * speed * uWindSpeed * 0.3;

		float n = fbm(p);

		// Shape clouds: threshold creates gaps, smoothstep gives soft edges
		float cloud = smoothstep(threshold, threshold + 0.25, n);

		return cloud;
	}

	void main() {
		vec2 uv = vUv;
		float aspect = uResolution.x / uResolution.y;
		uv.x *= aspect;

		// === Three parallax cloud layers ===
		// Parallax values: far=0.05 (barely moves), mid=0.2 (moderate), near=0.5 (strong)
		// This creates depth: when the plane turns, near clouds slide fast,
		// far clouds barely move — revealing layers at different distances.

		// Far layer: large slow-moving sheets (high cirrus) — barely shifts
		float far = cloudLayer(uv, 1.5, 0.01, 0.0, 0.35, 0.05);

		// Mid layer: medium cumulus formations — moderate shift
		float mid = cloudLayer(uv, 3.0, 0.025, 10.0, 0.38, 0.2);

		// Near layer: fast-moving wisps across the window — strong shift
		float near = cloudLayer(uv, 5.0, 0.06, 20.0, 0.42, 0.5);

		// === Composite layers with depth-based opacity ===
		// Far clouds are dimmer (atmospheric scattering), near clouds are brighter
		float farDensity  = far  * 0.4;
		float midDensity  = mid  * 0.6;
		float nearDensity = near * 0.8;

		// Total cloud coverage
		float totalDensity = clamp(farDensity + midDensity + nearDensity, 0.0, 1.0);
		totalDensity *= uDensity;

		// === Altitude-based cloud deck masking ===
		// Clouds form a deck at ~15k-30k ft. The view through the window
		// changes depending on whether we're above, inside, or below it.
		float alt = uAltitude;
		float y = vUv.y; // 0 = bottom, 1 = top of screen

		// Above cloud deck (>30k ft): clouds below us — fade toward bottom
		float aboveMask = smoothstep(30000.0, 35000.0, alt) * smoothstep(0.6, 0.1, y);

		// Inside cloud deck (15k-25k): fog/whiteout, thicker at edges
		float inCloud = smoothstep(15000.0, 18000.0, alt) * (1.0 - smoothstep(25000.0, 30000.0, alt));
		float edgeDist = 2.0 * abs(y - 0.5); // 0 at center, 1 at edges
		float inMask = inCloud * mix(0.7, 1.0, edgeDist);

		// Below cloud deck (<15k ft): clouds above us — fade toward top
		float belowMask = (1.0 - smoothstep(12000.0, 15000.0, alt)) * smoothstep(0.4, 0.9, y);

		// Blend: use whichever zone we're in (they don't overlap due to smoothstep ranges)
		float altMask = clamp(aboveMask + inMask + belowMask, 0.0, 1.0);

		// In the transition zones where no mask dominates, keep some base density
		float anyZone = max(max(smoothstep(30000.0, 35000.0, alt), inCloud),
		                     1.0 - smoothstep(12000.0, 15000.0, alt));
		altMask = mix(1.0, altMask, anyZone);

		totalDensity *= altMask;

		if (totalDensity < 0.001) {
			gl_FragColor = vec4(0.0);
			return;
		}

		// === Lighting ===
		// Approximate self-shadowing: sample noise offset in sun direction
		vec3 sunDir = normalize(uSunDirection);
		vec2 shadowOffset = sunDir.xz * 0.08;

		float shadowFar = cloudLayer(uv + shadowOffset, 1.5, 0.01, 0.0, 0.35, 0.05);
		float shadowMid = cloudLayer(uv + shadowOffset * 0.6, 3.0, 0.025, 10.0, 0.38, 0.2);
		float shadowDensity = clamp(shadowFar * 0.5 + shadowMid * 0.5, 0.0, 1.0);

		// Beer-Lambert shadow attenuation
		float shadowAtten = exp(-shadowDensity * 2.0);

		// Sunlit areas get cloud color, shadowed areas scatter sky color
		vec3 litColor = mix(uSkyColor * 0.4, uCloudColor, shadowAtten);

		// Silver lining: bright edges where sun backlights thin cloud
		float edgeFactor = smoothstep(0.0, 0.3, totalDensity) * (1.0 - smoothstep(0.3, 0.7, totalDensity));
		vec3 silverLining = uCloudColor * 1.3 * edgeFactor * max(shadowAtten, 0.3);

		vec3 finalColor = litColor + silverLining * 0.2;

		// Soft tone mapping
		finalColor = finalColor / (finalColor + vec3(1.0));

		// Alpha from total density
		float alpha = clamp(totalDensity, 0.0, 1.0);

		// Premultiplied alpha output
		gl_FragColor = vec4(finalColor * alpha, alpha);
	}
`;
