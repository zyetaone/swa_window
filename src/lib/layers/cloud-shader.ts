/**
 * Volumetric Cloud Shaders
 *
 * FBM raymarching shader for volumetric clouds rendered on a fullscreen quad.
 * Adapted for the Aero Window pipeline — uniforms driven by WindowModel state.
 *
 * The fragment shader implements:
 * - 3D FBM noise (4 octaves) with rotation between octaves
 * - Raymarching through an ellipsoidal cloud volume
 * - Shadow-marching toward the sun for self-shadowing
 * - Premultiplied alpha output for transparent canvas compositing over Cesium
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

	// --- Uniforms driven by WindowModel state ---
	uniform vec3 uCloudSize;       // ellipsoid shape of the cloud volume
	uniform vec3 uSunPosition;     // light direction
	uniform vec3 uCameraPosition;  // viewer position
	uniform vec3 uCloudColor;      // main cloud tint (white/amber/blue-gray by time)
	uniform vec3 uSkyColor;        // sky color for scattering through cloud
	uniform float uCloudSteps;     // ray march steps (24 day, 16 night)
	uniform float uShadowSteps;    // shadow march steps
	uniform float uCloudLength;    // total ray distance
	uniform float uShadowLength;   // shadow ray distance
	uniform vec2 uResolution;      // viewport size in pixels
	uniform float uTime;           // elapsed time for animation
	uniform float uFocalLength;    // camera focal length
	uniform float uDensity;        // cloud density multiplier (0-1)

	varying vec2 vUv;

	// --- Rotation matrix applied between FBM octaves ---
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
		// Smooth Hermite interpolation
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

	// --- Fractional Brownian Motion (3 octaves — optimized for Pi 5) ---
	float fbm(vec3 p) {
		float f = 0.0;
		f += 0.5000 * noise(p); p = m * p * 2.02;
		f += 0.2500 * noise(p); p = m * p * 2.03;
		f += 0.1250 * noise(p);
		return f / 0.875; // renormalize to ~0-1 range
	}

	// --- Cloud density at a point in the volume ---
	// Ellipsoid falloff combined with FBM noise
	float cloudDepth(vec3 position) {
		// Ellipsoidal distance: 1.0 at center, 0.0 at boundary
		float ellipse = 1.0 - length(position * uCloudSize);
		// Animated noise adds detail; uTime drift creates slow movement
		float cloud = ellipse + fbm(position + uTime * 0.02) * 2.2;
		return clamp(cloud * uDensity, 0.0, 1.0);
	}

	// --- Camera look-at matrix for constructing view rays ---
	mat3 lookAt(vec3 target, vec3 origin) {
		vec3 cw = normalize(origin - target);
		vec3 cu = normalize(cross(cw, origin));
		vec3 cv = normalize(cross(cu, cw));
		return mat3(cu, cv, cw);
	}

	void main() {
		// --- Construct view ray from screen coordinates ---
		vec2 screenPos = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
		screenPos.x *= uResolution.x / uResolution.y; // aspect correction

		mat3 viewMatrix = lookAt(vec3(0.0), uCameraPosition);
		vec3 rayDir = normalize(viewMatrix * vec3(screenPos, -uFocalLength));
		vec3 rayPos = uCameraPosition;

		// --- Normalize sun direction for lighting ---
		vec3 sunDir = normalize(uSunPosition);

		// --- Raymarch parameters ---
		float stepSize = uCloudLength / uCloudSteps;
		float shadowStepSize = uShadowLength / uShadowSteps;

		// --- Accumulation variables ---
		float transmittance = 1.0;   // how much light passes through
		vec3 scatteredLight = vec3(0.0); // accumulated light toward camera

		// --- Primary ray march through the cloud volume ---
		for (float i = 0.0; i < 64.0; i += 1.0) {
			if (i >= uCloudSteps) break;

			vec3 samplePos = rayPos + rayDir * (i * stepSize);
			float density = cloudDepth(samplePos);

			if (density > 0.001) {
				// --- Shadow march toward the sun for self-shadowing ---
				float shadowDensity = 0.0;
				for (float j = 0.0; j < 16.0; j += 1.0) {
					if (j >= uShadowSteps) break;
					vec3 shadowPos = samplePos + sunDir * (j * shadowStepSize);
					shadowDensity += cloudDepth(shadowPos);
				}

				// Beer-Lambert attenuation for shadow
				float shadowAtten = exp(-shadowDensity * shadowStepSize * 3.0);

				// --- Lighting: blend cloud color with sky scattering ---
				// Sunlit portions get the cloud color; shadowed portions scatter sky color
				vec3 lightContrib = mix(uSkyColor * 0.3, uCloudColor, shadowAtten);

				// Accumulate using Beer-Lambert along the primary ray
				float sampleAtten = exp(-density * stepSize * 2.0);
				scatteredLight += lightContrib * density * transmittance * stepSize;
				transmittance *= sampleAtten;

				// Early exit when cloud is fully opaque
				if (transmittance < 0.01) break;
			}
		}

		// --- Alpha is the amount of cloud coverage at this pixel ---
		float alpha = 1.0 - transmittance;
		alpha = clamp(alpha, 0.0, 1.0);

		// --- Tone mapping: prevent over-bright clouds ---
		vec3 finalColor = scatteredLight / (scatteredLight + vec3(1.0));

		// --- Premultiplied alpha output ---
		// Non-cloud pixels are fully transparent so Cesium terrain shows through
		gl_FragColor = vec4(finalColor * alpha, alpha);
	}
`;
