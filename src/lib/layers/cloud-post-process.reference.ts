/**
 * Cloud Post-Process Shader for Cesium
 *
 * Ported from cloud-shader.ts (Three.js) to Cesium PostProcessStage.
 * Camera-driven parallax clouds composited directly over the scene.
 *
 * Key differences from the Three.js version:
 *   - No vertex shader needed (Cesium handles fullscreen quad)
 *   - Scene read via `texture(colorTexture, uv)` instead of separate CSS layer
 *   - Cloud color/sun direction computed from u_nightFactor/u_dawnDuskFactor
 *     uniforms (moved from CloudScene.svelte's per-frame JS switch)
 *   - Resolution from czm_viewport.zw (Cesium built-in)
 *   - Uses texture() instead of texture2D(), out_FragColor instead of gl_FragColor
 */

export const CLOUD_POST_PROCESS_GLSL = /* glsl */ `
	uniform sampler2D colorTexture;
	uniform sampler2D u_cloudNoise;
	uniform sampler2D u_cloudDetail;
	uniform float u_time;
	uniform float u_density;
	uniform float u_windSpeed;
	uniform float u_heading;
	uniform float u_pitch;
	uniform float u_altitude;
	uniform float u_nightFactor;
	uniform float u_dawnDuskFactor;
	uniform float u_useTextures;

	in vec2 v_textureCoordinates;

	// --- Circadian cloud color/sky/sun computed from uniforms ---
	// Replaces the per-frame JS switch in CloudScene.svelte

	vec3 getCloudColor(float nightFactor, float dawnDuskFactor) {
		vec3 dayColor     = vec3(0.92, 0.92, 0.95);
		vec3 dawnDuskColor = vec3(0.92, 0.75, 0.42);
		vec3 nightColor   = vec3(0.3, 0.35, 0.5);
		vec3 c = dayColor;
		c = mix(c, dawnDuskColor, smoothstep(0.3, 1.0, dawnDuskFactor));
		c = mix(c, nightColor, smoothstep(0.7, 1.0, nightFactor));
		return c;
	}

	vec3 getSkyColor(float nightFactor, float dawnDuskFactor) {
		vec3 dayColor     = vec3(0.2, 0.47, 1.0);
		vec3 dawnDuskColor = vec3(0.6, 0.4, 0.2);
		vec3 nightColor   = vec3(0.04, 0.04, 0.08);
		vec3 c = dayColor;
		c = mix(c, dawnDuskColor, smoothstep(0.3, 1.0, dawnDuskFactor));
		c = mix(c, nightColor, smoothstep(0.7, 1.0, nightFactor));
		return c;
	}

	vec3 getSunDirection(float nightFactor, float dawnDuskFactor) {
		// Blend between sky states for smooth transitions
		vec3 dayDir     = normalize(vec3(1.0, 2.0, 1.0));
		vec3 dawnDir    = normalize(vec3(-1.0, 0.5, 1.0));
		vec3 duskDir    = normalize(vec3(1.0, 0.3, -1.0));
		vec3 nightDir   = normalize(vec3(0.0, -1.0, 0.0));

		// Dawn/dusk blend: use dawnDuskFactor with sign from nightFactor slope
		// nightFactor < 0.5 = coming from night (dawn), > 0.5 = going to night (dusk)
		vec3 twilightDir = mix(dawnDir, duskDir, smoothstep(0.3, 0.7, nightFactor));
		vec3 d = dayDir;
		d = mix(d, twilightDir, smoothstep(0.3, 1.0, dawnDuskFactor));
		d = mix(d, nightDir, smoothstep(0.7, 1.0, nightFactor));
		return normalize(d);
	}

	// --- Rotation matrix between FBM octaves ---
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

	// --- FBM cloud layer with camera-driven parallax ---
	float cloudLayer(vec2 uv, float scale, float speed, float zLayer, float threshold, float parallax) {
		vec2 cameraOffset = vec2(
			u_heading * parallax,
			u_pitch * parallax * 0.5
		);

		vec3 p = vec3((uv + cameraOffset) * scale, zLayer + u_time * 0.005);
		p.x += u_time * speed * u_windSpeed;
		p.y += u_time * speed * u_windSpeed * 0.3;

		float n = fbm(p);
		float cloud = smoothstep(threshold, threshold + 0.25, n);
		return cloud;
	}

	// --- Texture-based cloud layer ---
	float cloudLayerTex(vec2 uv, float scale, float speed, float zLayer, float threshold, float parallax, int layerType) {
		vec2 cameraOffset = vec2(
			u_heading * parallax,
			u_pitch * parallax * 0.5
		);

		vec2 st = (uv + cameraOffset) * scale;
		st.x += u_time * speed * u_windSpeed;
		st.y += u_time * speed * u_windSpeed * 0.3;

		float zDrift = u_time * 0.005 + zLayer * 0.01;
		st += vec2(sin(zDrift) * 0.1, cos(zDrift) * 0.08);

		float n;

		if (layerType == 0) {
			vec4 s = texture(u_cloudNoise, fract(st));
			n = s.r * 0.6 + s.a * 0.4;
		} else if (layerType == 1) {
			vec4 s = texture(u_cloudNoise, fract(st));
			float detail = texture(u_cloudDetail, fract(st * 2.03 + zDrift * 0.7)).r;
			n = s.r * 0.5 + s.g * 0.2 + detail * 0.3;
		} else {
			vec4 curl = texture(u_cloudDetail, fract(st * 0.5));
			vec2 distorted = st + vec2(curl.g, curl.b) * 0.15;
			vec4 s = texture(u_cloudNoise, fract(distorted));
			n = s.b * 0.5 + curl.a * 0.3 + s.r * 0.2;
		}

		float cloud = smoothstep(threshold, threshold + 0.25, n);
		return cloud;
	}

	void main() {
		vec4 scene = texture(colorTexture, v_textureCoordinates);

		vec2 uv = v_textureCoordinates;
		vec2 resolution = czm_viewport.zw;
		float aspect = resolution.x / resolution.y;
		uv.x *= aspect;

		// === Three parallax cloud layers ===
		float far_l, mid_l, near_l;

		if (u_useTextures > 0.5) {
			far_l  = cloudLayerTex(uv, 1.5, 0.01, 0.0,  0.35, 0.05, 0);
			mid_l  = cloudLayerTex(uv, 3.0, 0.025, 10.0, 0.38, 0.2,  1);
			near_l = cloudLayerTex(uv, 5.0, 0.06, 20.0,  0.42, 0.5,  2);
		} else {
			far_l  = cloudLayer(uv, 1.5, 0.01, 0.0,  0.35, 0.05);
			mid_l  = cloudLayer(uv, 3.0, 0.025, 10.0, 0.38, 0.2);
			near_l = cloudLayer(uv, 5.0, 0.06, 20.0,  0.42, 0.5);
		}

		// === Composite layers with depth-based opacity ===
		float farDensity  = far_l  * 0.4;
		float midDensity  = mid_l  * 0.6;
		float nearDensity = near_l * 0.8;

		float totalDensity = clamp(farDensity + midDensity + nearDensity, 0.0, 1.0);
		totalDensity *= u_density;

		// === Altitude-based cloud deck masking ===
		float alt = u_altitude;
		float y = v_textureCoordinates.y;

		float aboveMask = smoothstep(30000.0, 35000.0, alt) * smoothstep(0.6, 0.1, y);
		float inCloud = smoothstep(15000.0, 18000.0, alt) * (1.0 - smoothstep(25000.0, 30000.0, alt));
		float edgeDist = 2.0 * abs(y - 0.5);
		float inMask = inCloud * mix(0.7, 1.0, edgeDist);
		float belowMask = (1.0 - smoothstep(12000.0, 15000.0, alt)) * smoothstep(0.4, 0.9, y);

		float altMask = clamp(aboveMask + inMask + belowMask, 0.0, 1.0);
		float anyZone = max(max(smoothstep(30000.0, 35000.0, alt), inCloud),
		                     1.0 - smoothstep(12000.0, 15000.0, alt));
		altMask = mix(1.0, altMask, anyZone);

		totalDensity *= altMask;

		if (totalDensity < 0.001) {
			out_FragColor = scene;
			return;
		}

		// === Lighting ===
		vec3 cloudColor = getCloudColor(u_nightFactor, u_dawnDuskFactor);
		vec3 skyColor = getSkyColor(u_nightFactor, u_dawnDuskFactor);
		vec3 sunDir = getSunDirection(u_nightFactor, u_dawnDuskFactor);

		vec2 shadowOffset = sunDir.xz * 0.08;

		float shadowFar, shadowMid;
		if (u_useTextures > 0.5) {
			shadowFar = cloudLayerTex(uv + shadowOffset, 1.5, 0.01, 0.0, 0.35, 0.05, 0);
			shadowMid = cloudLayerTex(uv + shadowOffset * 0.6, 3.0, 0.025, 10.0, 0.38, 0.2, 1);
		} else {
			shadowFar = cloudLayer(uv + shadowOffset, 1.5, 0.01, 0.0, 0.35, 0.05);
			shadowMid = cloudLayer(uv + shadowOffset * 0.6, 3.0, 0.025, 10.0, 0.38, 0.2);
		}
		float shadowDensity = clamp(shadowFar * 0.5 + shadowMid * 0.5, 0.0, 1.0);

		// Beer-Lambert shadow attenuation
		float shadowAtten = exp(-shadowDensity * 2.0);

		// Sunlit areas get cloud color, shadowed areas scatter sky color
		vec3 litColor = mix(skyColor * 0.4, cloudColor, shadowAtten);

		// Silver lining: bright edges where sun backlights thin cloud
		float edgeFactor = smoothstep(0.0, 0.3, totalDensity) * (1.0 - smoothstep(0.3, 0.7, totalDensity));
		vec3 silverLining = cloudColor * 1.3 * edgeFactor * max(shadowAtten, 0.3);

		vec3 finalColor = litColor + silverLining * 0.2;

		// Soft tone mapping
		finalColor = finalColor / (finalColor + vec3(1.0));

		float alpha = clamp(totalDensity, 0.0, 1.0);

		// Blend clouds over the scene
		out_FragColor = mix(scene, vec4(finalColor, 1.0), alpha);
	}
`;
