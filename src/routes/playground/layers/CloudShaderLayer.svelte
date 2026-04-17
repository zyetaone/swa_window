<script lang="ts">
/**
 * CloudShaderLayer — GPU cloud overlay rendered inside MapLibre's GL pipeline.
 *
 * Uses a MapLibre CustomLayer to draw a fullscreen quad with a multi-octave
 * cloud fragment shader. Shares the same noise-sampling approach as
 * WebGLClouds.svelte but outputs premultiplied alpha for correct compositing
 * within MapLibre's render loop.
 *
 * GL state is carefully saved/restored around every draw call so MapLibre's
 * own rendering is not disrupted.
 */

import { CustomLayer } from 'svelte-maplibre-gl';
import maplibregl from 'maplibre-gl';
import type { WeatherType } from '$lib/types';

let {
	density = 0.6,
	speed = 1.0,
	heading = 90,
	nightFactor = 0,
	altitude = 30000,
	weather = 'clear' as WeatherType,
	cloudScale = 1.0,
}: {
	density?: number;
	speed?: number;
	heading?: number;
	nightFactor?: number;
	altitude?: number;
	weather?: WeatherType;
	cloudScale?: number;
} = $props();

// ── Plain-JS uniforms bridge ────────────────────────────────────────
// Synced from props via $effect. The render() hot path reads this object
// directly — no Svelte reactivity in the GL draw call.
const uniforms = {
	time: 0,
	heading: 90,
	speed: 1,
	density: 0.6,
	nightFactor: 0,
	altitude: 30000,
	cloudScale: 1,
	weatherDark: 0,
	resW: 1920,
	resH: 1080,
};

$effect(() => {
	uniforms.heading = heading;
	uniforms.speed = speed;
	uniforms.density = density;
	uniforms.nightFactor = nightFactor;
	uniforms.altitude = altitude;
	uniforms.cloudScale = cloudScale;
	uniforms.weatherDark =
		weather === 'storm'
			? 1.0
			: weather === 'rain'
				? 0.7
				: weather === 'overcast'
					? 0.4
					: weather === 'cloudy'
						? 0.2
						: 0.0;
});

// ── Noise texture generator ─────────────────────────────────────────
// 512x512 value noise, 32px grid cells, bilinear interpolation + smoothstep.
// Baked once in onAdd(). REPEAT wrap + LINEAR filtering.
function generateNoiseTexture(size: number): Uint8Array {
	const data = new Uint8Array(size * size * 4);
	const grid = 32;
	const cells = Math.ceil(size / grid) + 1;
	const rng = new Array(cells * cells).fill(0).map(() => Math.random());

	function gridVal(ix: number, iy: number): number {
		return rng[(iy % cells) * cells + (ix % cells)];
	}

	function smoothstep(t: number): number {
		return t * t * (3 - 2 * t);
	}

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const gx = x / grid;
			const gy = y / grid;
			const ix = Math.floor(gx);
			const iy = Math.floor(gy);
			const fx = smoothstep(gx - ix);
			const fy = smoothstep(gy - iy);

			const v00 = gridVal(ix, iy);
			const v10 = gridVal(ix + 1, iy);
			const v01 = gridVal(ix, iy + 1);
			const v11 = gridVal(ix + 1, iy + 1);
			const v0 = v00 + (v10 - v00) * fx;
			const v1 = v01 + (v11 - v01) * fx;
			const v = v0 + (v1 - v0) * fy;

			const byte = Math.floor(v * 255);
			const idx = (y * size + x) * 4;
			data[idx] = byte;
			data[idx + 1] = byte;
			data[idx + 2] = byte;
			data[idx + 3] = 255;
		}
	}
	return data;
}

// ── Shaders ─────────────────────────────────────────────────────────
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_noise;
uniform float u_time;
uniform float u_heading;
uniform float u_speed;
uniform float u_density;
uniform float u_nightFactor;
uniform float u_altitude;
uniform float u_cloudScale;
uniform float u_weatherDark;
uniform vec2 u_resolution;

float cloudLayer(vec2 uv, float scale, float speedMul, float time) {
  float headRad = u_heading * 0.01745329;
  vec2 drift = vec2(cos(headRad), sin(headRad) * 0.4) * time * speedMul * u_speed;
  vec2 st = uv * scale + drift;
  float n1 = texture2D(u_noise, fract(st)).r;
  float n2 = texture2D(u_noise, fract(st * 2.13 + 0.37)).r;
  return n1 * 0.7 + n2 * 0.3;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  uv.x *= aspect;

  float scale = 1.0 / max(u_cloudScale, 0.3);

  // Three cloud layers — far (slow), mid, near (fast)
  float far  = cloudLayer(uv, 1.5 * scale, 0.008, u_time);
  float mid  = cloudLayer(uv + vec2(0.31, 0.17), 2.5 * scale, 0.025, u_time);
  float near = cloudLayer(uv + vec2(0.67, 0.43), 4.0 * scale, 0.06, u_time);

  // Density threshold
  float thresh = 1.0 - u_density;
  far  = smoothstep(thresh, thresh + 0.25, far);
  mid  = smoothstep(thresh + 0.05, thresh + 0.3, mid);
  near = smoothstep(thresh + 0.1, thresh + 0.35, near);

  float cloud = far * 0.5 + mid * 0.3 + near * 0.2;

  // Altitude modulation
  float altFactor = smoothstep(18000.0, 28000.0, u_altitude);
  cloud *= mix(1.2, 0.6, altFactor);

  // Horizon fade
  float horizonFade = smoothstep(0.0, 0.3, v_uv.y) * smoothstep(1.0, 0.6, v_uv.y);
  cloud *= horizonFade;

  // Color
  float dark = u_weatherDark;
  vec3 dayColor = vec3(1.0 - dark * 0.3, 1.0 - dark * 0.25, 1.0 - dark * 0.15);
  vec3 nightColor = vec3(0.55, 0.6, 0.75);
  vec3 color = mix(dayColor, nightColor, u_nightFactor);

  float alpha = cloud * u_density * 1.2;
  alpha = clamp(alpha, 0.0, 0.85);

  // Premultiplied alpha for MapLibre compositing
  gl_FragColor = vec4(color * alpha, alpha);
}`;

// ── CustomLayerInterface implementation ─────────────────────────────
let mapRef: maplibregl.Map | null = null;
let glProgram: WebGLProgram | null = null;
let vertShader: WebGLShader | null = null;
let fragShader: WebGLShader | null = null;
let quadVBO: WebGLBuffer | null = null;
let noiseTex: WebGLTexture | null = null;
let startTime = 0;
let frameCount = 0;

// Cached uniform locations
let uLoc: Record<string, WebGLUniformLocation | null> = {};

function handleResize() {
	if (!mapRef) return;
	const canvas = mapRef.getCanvas();
	uniforms.resW = canvas.width;
	uniforms.resH = canvas.height;
}

const impl: Omit<maplibregl.CustomLayerInterface, 'id' | 'type'> = {
	renderingMode: '2d' as const,

	onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
		mapRef = map;

		// Compile vertex shader
		vertShader = gl.createShader(gl.VERTEX_SHADER);
		if (!vertShader) return;
		gl.shaderSource(vertShader, VERT);
		gl.compileShader(vertShader);
		if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
			console.warn('[CloudShaderLayer] Vertex shader error:', gl.getShaderInfoLog(vertShader));
			return;
		}

		// Compile fragment shader
		fragShader = gl.createShader(gl.FRAGMENT_SHADER);
		if (!fragShader) return;
		gl.shaderSource(fragShader, FRAG);
		gl.compileShader(fragShader);
		if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
			console.warn('[CloudShaderLayer] Fragment shader error:', gl.getShaderInfoLog(fragShader));
			return;
		}

		// Link program
		glProgram = gl.createProgram();
		if (!glProgram) return;
		gl.attachShader(glProgram, vertShader);
		gl.attachShader(glProgram, fragShader);
		gl.linkProgram(glProgram);
		if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
			console.warn('[CloudShaderLayer] Link error:', gl.getProgramInfoLog(glProgram));
			return;
		}

		// Fullscreen quad VBO: two triangles via TRIANGLE_STRIP
		quadVBO = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
			gl.STATIC_DRAW,
		);

		// Cache uniform locations
		const names = [
			'u_noise',
			'u_time',
			'u_heading',
			'u_speed',
			'u_density',
			'u_nightFactor',
			'u_altitude',
			'u_cloudScale',
			'u_weatherDark',
			'u_resolution',
		];
		uLoc = {};
		for (const name of names) {
			uLoc[name] = gl.getUniformLocation(glProgram, name);
		}

		// Generate + upload noise texture (512x512, baked once)
		const NOISE_SIZE = 512;
		const noiseData = generateNoiseTexture(NOISE_SIZE);
		noiseTex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, noiseTex);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			NOISE_SIZE,
			NOISE_SIZE,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			noiseData,
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

		// Record start time + canvas dimensions
		startTime = performance.now();
		const canvas = map.getCanvas();
		uniforms.resW = canvas.width;
		uniforms.resH = canvas.height;

		// Resize listener
		map.on('resize', handleResize);
	},

	render(gl: WebGLRenderingContext, _options: unknown) {
		if (!glProgram || !quadVBO || !noiseTex || !mapRef) return;

		// 30fps throttle: on odd frames, just request repaint and skip draw
		frameCount++;
		if (frameCount % 2 === 1) {
			mapRef.triggerRepaint();
			return;
		}

		// ── Save GL state ────────────────────────────────────────────
		const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
		const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
		const prevTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
		const prevVBO = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
		const prevBlendSrc = gl.getParameter(gl.BLEND_SRC_RGB);
		const prevBlendDst = gl.getParameter(gl.BLEND_DST_RGB);
		const prevBlendSrcA = gl.getParameter(gl.BLEND_SRC_ALPHA);
		const prevBlendDstA = gl.getParameter(gl.BLEND_DST_ALPHA);

		// WebGL2 VAO — unbind so our VBO/attrib state doesn't corrupt MapLibre's VAO
		const gl2 = gl as WebGL2RenderingContext;
		const hasVAO = typeof gl2.VERTEX_ARRAY_BINDING !== 'undefined';
		const prevVAO = hasVAO ? gl2.getParameter(gl2.VERTEX_ARRAY_BINDING) : null;
		if (hasVAO) gl2.bindVertexArray(null);

		// ── Draw ─────────────────────────────────────────────────────
		gl.useProgram(glProgram);

		// Set uniforms
		const t = (performance.now() - startTime) / 1000;
		gl.uniform1i(uLoc['u_noise'], 0);
		gl.uniform1f(uLoc['u_time'], t);
		gl.uniform1f(uLoc['u_heading'], uniforms.heading);
		gl.uniform1f(uLoc['u_speed'], uniforms.speed);
		gl.uniform1f(uLoc['u_density'], uniforms.density);
		gl.uniform1f(uLoc['u_nightFactor'], uniforms.nightFactor);
		gl.uniform1f(uLoc['u_altitude'], uniforms.altitude);
		gl.uniform1f(uLoc['u_cloudScale'], uniforms.cloudScale);
		gl.uniform1f(uLoc['u_weatherDark'], uniforms.weatherDark);
		gl.uniform2f(uLoc['u_resolution'], uniforms.resW, uniforms.resH);

		// Bind noise texture to unit 0
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, noiseTex);

		// Bind quad VBO + configure a_pos attribute
		gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
		const aPosLoc = gl.getAttribLocation(glProgram, 'a_pos');
		gl.enableVertexAttribArray(aPosLoc);
		gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

		// Premultiplied alpha blending
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

		// Draw fullscreen quad
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		// ── Restore GL state ─────────────────────────────────────────
		gl.disableVertexAttribArray(aPosLoc);
		gl.blendFuncSeparate(prevBlendSrc, prevBlendDst, prevBlendSrcA, prevBlendDstA);
		gl.bindBuffer(gl.ARRAY_BUFFER, prevVBO);
		gl.bindTexture(gl.TEXTURE_2D, prevTexture);
		gl.activeTexture(prevActiveTexture);
		gl.useProgram(prevProgram);

		// Restore VAO if it existed
		if (hasVAO && prevVAO !== null) {
			gl2.bindVertexArray(prevVAO);
		}

		// Keep animating
		mapRef.triggerRepaint();
	},

	onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext) {
		if (mapRef) {
			mapRef.off('resize', handleResize);
		}

		if (glProgram) {
			gl.deleteProgram(glProgram);
			glProgram = null;
		}
		if (vertShader) {
			gl.deleteShader(vertShader);
			vertShader = null;
		}
		if (fragShader) {
			gl.deleteShader(fragShader);
			fragShader = null;
		}
		if (quadVBO) {
			gl.deleteBuffer(quadVBO);
			quadVBO = null;
		}
		if (noiseTex) {
			gl.deleteTexture(noiseTex);
			noiseTex = null;
		}

		mapRef = null;
		uLoc = {};
	},
};
</script>

<CustomLayer implementation={impl} />
