/**
 * Procedural building emissive shader.
 *
 * Restored from Feb 15 (commit 4697680:src/lib/layers/cesium-shaders.ts —
 * see BUILDING_SHADER_GLSL). Applied to Cesium's OSM buildings tileset via
 * customShader so we get lit-window detail without needing per-feature
 * height properties (the Phase-16 ${height}/250 expression crashed when
 * features lacked that property — see commit c59ad58).
 *
 * Per-fragment composition:
 *   - surface orientation: wall vs roof via dot(normal, up)
 *   - per-floor grid: floor(wp.z / 3.0)
 *   - per-window cell hash: 80% windows lit when density ramps up; some
 *     floors fully lit (~7% — office overnight) some floors dark
 *   - 5 window colors mixed by cell hash:
 *       warm residential, cool office, retail/lobby, blue screen,
 *       fluorescent office white
 *   - per-window brightness variation
 *   - AC-hum flicker (sin(u_time))
 *   - street-lamp glow at ground level
 *   - aviation warning beacons on tall rooftops (sodium-red blink)
 *
 * Uniforms:
 *   u_nightFactor    0..1 — emission gated entirely on this
 *   u_lightIntensity operator knob (nightLightScale)
 *   u_windowDensity  fraction of windows lit (peaks ~0.5 at deep night)
 *   u_time           seconds — drives flicker + aviation blink
 *
 * Why a customShader (not Cesium3DTileStyle):
 *   Style expressions are color-only and reference feature properties.
 *   OSM buildings don't all carry a `height` property; expressions
 *   crash on `undefined / N`. A custom shader runs in model-space and
 *   uses fragment-local position (`fsInput.attributes.positionMC.z`)
 *   for floor counting — works on every feature.
 */

/**
 * Vertex shader — passes model-space normal as a varying so the
 * fragment can do wall/roof detection. Modern Cesium CustomShader
 * doesn't expose normalMC directly in the fragment stage (only normalEC,
 * which rotates with the camera).
 */
export const BUILDING_VERTEX_GLSL = `
	void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
		v_normalMC = vsInput.attributes.normalMC;
	}
`;

export const BUILDING_SHADER_GLSL = `
	void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
		vec3 normal = normalize(v_normalMC);

		// Surface orientation detection
		float upDot = abs(dot(normal, vec3(0.0, 0.0, 1.0)));
		float isWall = smoothstep(0.3, 0.7, 1.0 - upDot);
		float isRoof = smoothstep(0.7, 0.9, upDot);

		vec3 wp = fsInput.attributes.positionMC;
		float buildingHeight = wp.z;
		float floorHeight = 3.0;
		float floorIndex = floor(wp.z / floorHeight);
		float isGroundFloor = step(floorIndex, 0.5);

		// Height-based window density: taller buildings = more lit (office towers).
		float heightFactor = smoothstep(10.0, 80.0, buildingHeight);
		float adjustedDensity = mix(u_windowDensity * 0.4, u_windowDensity * 1.3, heightFactor);

		// Window grid pattern
		float windowWidth = mix(0.55, 0.8, isGroundFloor);
		float windowHeight = mix(0.65, 0.85, isGroundFloor);
		vec2 gridUV = fract(vec2(wp.x * 0.12, wp.z / floorHeight));
		float windowX = smoothstep(0.5 - windowWidth * 0.5, 0.5 - windowWidth * 0.5 + 0.05, gridUV.x)
		             * smoothstep(0.5 + windowWidth * 0.5, 0.5 + windowWidth * 0.5 - 0.05, gridUV.x);
		float windowY = smoothstep(0.5 - windowHeight * 0.5, 0.5 - windowHeight * 0.5 + 0.05, gridUV.y)
		             * smoothstep(0.5 + windowHeight * 0.5, 0.5 + windowHeight * 0.5 - 0.05, gridUV.y);
		float windowMask = windowX * windowY;

		// Per-window random (hash from cell position)
		vec2 cellId = vec2(floor(wp.x * 0.12), floorIndex);
		float rand = fract(sin(dot(cellId, vec2(127.1, 311.7))) * 43758.5453);

		// Floor-level randomization (some whole floors dark = empty offices)
		float floorRand = fract(sin(floorIndex * 131.7) * 43758.5453);
		float floorLit = step(0.2, floorRand);
		float fullyLitFloor = step(0.93, floorRand); // ~7% of floors fully lit

		float lit = step(1.0 - adjustedDensity, rand) * floorLit;
		lit = max(lit, fullyLitFloor); // fully lit floors override

		// Window color variation (5 types)
		float colorMix = fract(sin(dot(cellId, vec2(269.5, 183.3))) * 7461.7);
		vec3 warmColor   = vec3(1.0, 0.65, 0.35);    // warm residential
		vec3 coolColor   = vec3(0.8, 0.9, 1.0);       // cool office
		vec3 retailColor = vec3(1.0, 0.85, 0.6);     // retail/lobby
		vec3 screenColor = vec3(0.55, 0.65, 1.0);    // blueish screens
		vec3 officeWhite = vec3(1.0, 0.97, 0.92);    // fluorescent office

		vec3 upperColor = mix(
			mix(warmColor, coolColor, smoothstep(0.0, 0.4, colorMix)),
			mix(screenColor, officeWhite, smoothstep(0.6, 1.0, colorMix)),
			step(0.5, colorMix)
		);
		vec3 windowColor = mix(upperColor, retailColor, isGroundFloor);

		// Per-window brightness variation
		float brightVar = fract(sin(dot(cellId, vec2(419.2, 371.9))) * 29475.1);
		float windowBright = mix(0.6, 1.4, brightVar);

		// Subtle flicker (AC hum simulation)
		float flicker = 0.93 + 0.07 * sin(u_time * 0.3 + rand * 6.28);

		// Street-level ambient glow (sodium lamps illuminate building bases)
		float streetGlow = smoothstep(6.0, 0.0, wp.z) * 0.4;
		vec3 streetLampColor = vec3(1.0, 0.82, 0.45);

		// Rooftop aviation warning lights (tall buildings only, slow blink)
		float isTall = smoothstep(30.0, 50.0, buildingHeight);
		float blink = step(0.4, fract(u_time * 0.5));
		float rooftopLight = isRoof * isTall * blink;
		vec3 aviationRed = vec3(1.0, 0.08, 0.03);

		// Darken building surfaces at night so emissive reads cleanly.
		material.diffuse *= mix(1.0, 0.015, u_nightFactor);

		// Compose emission layers
		vec3 emission = vec3(0.0);
		emission += windowColor * windowMask * lit * isWall * flicker * windowBright * 2.2 * u_lightIntensity;
		emission += streetLampColor * streetGlow * isWall;
		emission += aviationRed * rooftopLight * 4.0;

		material.emissive = emission * u_nightFactor;
	}
`;
