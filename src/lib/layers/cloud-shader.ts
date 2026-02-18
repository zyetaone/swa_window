/**
 * Procedural Cloud Shaders — Airplane Window View
 *
 * Screen-space FBM noise clouds designed for a window-out perspective.
 * Three parallax layers at different scales/speeds create depth illusion:
 *   - Far layer: large, slow-moving cloud sheets (high altitude cirrus)
 *   - Mid layer: medium cumulus formations with self-shadowing
 *   - Near layer: fast-moving wisps that drift across the window
 *
 * Each layer uses 3-octave FBM noise sampled at UV coordinates (not raymarched).
 * GPU cost: ~9 noise evaluations per pixel (3 octaves × 3 layers). Pi 5 friendly.
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

	// --- Cloud layer: returns density at a screen position ---
	// scale: UV multiplier (larger = smaller cloud features)
	// speed: time drift multiplier (larger = faster)
	// zLayer: z offset for 3D noise (separates layers)
	// threshold: noise cutoff (higher = sparser clouds)
	float cloudLayer(vec2 uv, float scale, float speed, float zLayer, float threshold) {
		vec3 p = vec3(uv * scale, zLayer + uTime * 0.005);
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

		// Far layer: large slow-moving sheets (high cirrus)
		float far = cloudLayer(uv, 1.5, 0.01, 0.0, 0.35);

		// Mid layer: medium cumulus formations
		float mid = cloudLayer(uv, 3.0, 0.025, 10.0, 0.38);

		// Near layer: fast-moving wisps across the window
		float near = cloudLayer(uv, 5.0, 0.06, 20.0, 0.42);

		// === Composite layers with depth-based opacity ===
		// Far clouds are dimmer (atmospheric scattering), near clouds are brighter
		float farDensity  = far  * 0.4;
		float midDensity  = mid  * 0.6;
		float nearDensity = near * 0.8;

		// Total cloud coverage
		float totalDensity = clamp(farDensity + midDensity + nearDensity, 0.0, 1.0);
		totalDensity *= uDensity;

		if (totalDensity < 0.001) {
			gl_FragColor = vec4(0.0);
			return;
		}

		// === Lighting ===
		// Approximate self-shadowing: sample noise offset in sun direction
		vec3 sunDir = normalize(uSunDirection);
		vec2 shadowOffset = sunDir.xz * 0.08;

		float shadowFar = cloudLayer(uv + shadowOffset, 1.5, 0.01, 0.0, 0.35);
		float shadowMid = cloudLayer(uv + shadowOffset * 0.6, 3.0, 0.025, 10.0, 0.38);
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
