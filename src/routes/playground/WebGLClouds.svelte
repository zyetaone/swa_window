<script lang="ts">
/**
 * WebGLClouds — GPU-native cloud renderer for Pi 5 24/7 deployment.
 *
 * Architecture: single <canvas> at half resolution, one fullscreen quad,
 * one fragment shader, pre-baked noise texture. Throttled to 30fps.
 *
 * Why not SVG feTurbulence:
 *   SVG filters are CPU-computed (not GPU-accelerated on Pi Chromium).
 *   18 filter chains × 60fps = significant sustained CPU load.
 *   This WebGL approach: 1 draw call, 3 texture lookups per fragment,
 *   zero per-frame noise computation. CPU freed for MapLibre + Chromium.
 *
 * Noise strategy: a 512×512 Perlin noise texture is baked ONCE at init
 * (~3ms). The fragment shader samples it at 3 UV scales (far/mid/near)
 * with time-driven offset → multi-layer parallax from a single texture.
 *
 * Resolution: renders at 50% viewport size (e.g. 540p for 1080p).
 * CSS scales it up with bilinear filtering — clouds are inherently soft
 * so the upscale is invisible.
 */

import { untrack } from 'svelte';
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

let canvasEl: HTMLCanvasElement | undefined = $state();
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let noiseTexture: WebGLTexture | null = null;

// Uniform locations
let uTime: WebGLUniformLocation | null = null;
let uHeading: WebGLUniformLocation | null = null;
let uSpeed: WebGLUniformLocation | null = null;
let uDensity: WebGLUniformLocation | null = null;
let uNightFactor: WebGLUniformLocation | null = null;
let uAltitude: WebGLUniformLocation | null = null;
let uCloudScale: WebGLUniformLocation | null = null;
let uWeatherDark: WebGLUniformLocation | null = null;
let uResolution: WebGLUniformLocation | null = null;

// ── Noise texture generation ─────────────────────────────────────────
// 2D Perlin-like noise baked into a 512×512 RGBA texture once at init.
// Uses a simple value-noise approach (fast to compute, good enough for
// cloud shapes when sampled at multiple UV scales).
function generateNoiseTexture(size: number): Uint8Array {
	const data = new Uint8Array(size * size * 4);
	// Seed a grid of random values, then interpolate
	const grid = 32; // grid cell size
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

			// Bilinear interpolation of grid values
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

// ── Shaders ──────────────────────────────────────────────────────────
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

// Sample noise at a UV offset — simulates cloud layer drift.
// Each layer uses a different UV scale for parallax depth.
float cloudLayer(vec2 uv, float scale, float speedMul, float time) {
	float headRad = u_heading * 0.01745329; // deg→rad
	vec2 drift = vec2(cos(headRad), sin(headRad) * 0.4) * time * speedMul * u_speed;
	vec2 st = uv * scale + drift;
	// Two octaves from the same texture at different scales
	float n1 = texture2D(u_noise, fract(st)).r;
	float n2 = texture2D(u_noise, fract(st * 2.13 + 0.37)).r;
	return n1 * 0.7 + n2 * 0.3;
}

void main() {
	vec2 uv = v_uv;
	// Aspect correction
	float aspect = u_resolution.x / u_resolution.y;
	uv.x *= aspect;

	float scale = 1.0 / max(u_cloudScale, 0.3);

	// Three cloud layers — far (slow), mid, near (fast)
	float far  = cloudLayer(uv, 1.5 * scale, 0.008, u_time);
	float mid  = cloudLayer(uv + vec2(0.31, 0.17), 2.5 * scale, 0.025, u_time);
	float near = cloudLayer(uv + vec2(0.67, 0.43), 4.0 * scale, 0.06, u_time);

	// Density threshold — shapes clouds from noise (higher density = more coverage)
	float thresh = 1.0 - u_density;
	far  = smoothstep(thresh, thresh + 0.25, far);
	mid  = smoothstep(thresh + 0.05, thresh + 0.3, mid);
	near = smoothstep(thresh + 0.1, thresh + 0.35, near);

	// Combine layers — far is most opaque (distant cloud deck), near is wispy
	float cloud = far * 0.5 + mid * 0.3 + near * 0.2;

	// Altitude modulation — below cloud deck more coverage, above less
	float altFactor = smoothstep(18000.0, 28000.0, u_altitude);
	cloud *= mix(1.2, 0.6, altFactor);

	// Vertical gradient — more clouds at horizon (top), fewer at bottom
	float horizonFade = smoothstep(0.0, 0.3, v_uv.y) * smoothstep(1.0, 0.6, v_uv.y);
	cloud *= horizonFade;

	// Color: white base, gray for storm/rain, blue tint at night
	float dark = u_weatherDark;
	vec3 dayColor = vec3(1.0 - dark * 0.3, 1.0 - dark * 0.25, 1.0 - dark * 0.15);
	vec3 nightColor = vec3(0.55, 0.6, 0.75);
	vec3 color = mix(dayColor, nightColor, u_nightFactor);

	// Soft edge alpha — clouds dissolve at edges
	float alpha = cloud * u_density * 1.2;
	alpha = clamp(alpha, 0.0, 0.85);

	gl_FragColor = vec4(color, alpha);
}`;

// ── WebGL init ───────────────────────────────────────────────────────
function initWebGL(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext('webgl', {
		alpha: true,
		premultipliedAlpha: false,
		antialias: false,
		preserveDrawingBuffer: false,
	});
	if (!ctx) return;
	gl = ctx;

	// Compile shaders
	const vs = gl.createShader(gl.VERTEX_SHADER)!;
	gl.shaderSource(vs, VERT);
	gl.compileShader(vs);

	const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
	gl.shaderSource(fs, FRAG);
	gl.compileShader(fs);

	if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
		console.warn('[WebGLClouds] Fragment shader error:', gl.getShaderInfoLog(fs));
		return;
	}

	program = gl.createProgram()!;
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	gl.useProgram(program);

	// Fullscreen quad
	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(program, 'a_pos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	// Uniform locations
	uTime = gl.getUniformLocation(program, 'u_time');
	uHeading = gl.getUniformLocation(program, 'u_heading');
	uSpeed = gl.getUniformLocation(program, 'u_speed');
	uDensity = gl.getUniformLocation(program, 'u_density');
	uNightFactor = gl.getUniformLocation(program, 'u_nightFactor');
	uAltitude = gl.getUniformLocation(program, 'u_altitude');
	uCloudScale = gl.getUniformLocation(program, 'u_cloudScale');
	uWeatherDark = gl.getUniformLocation(program, 'u_weatherDark');
	uResolution = gl.getUniformLocation(program, 'u_resolution');

	// Bake noise texture (once, ~3ms)
	const NOISE_SIZE = 512;
	const noiseData = generateNoiseTexture(NOISE_SIZE);
	noiseTexture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NOISE_SIZE, NOISE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseData);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	// Blending for transparent clouds
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

// ── Render loop (30fps throttled) ────────────────────────────────────
$effect(() => {
	if (!canvasEl) return;

	// Half-res: CSS scales up with bilinear filtering (clouds are soft anyway)
	const resScale = 0.5;
	const resize = () => {
		if (!canvasEl) return;
		canvasEl.width = Math.floor(window.innerWidth * resScale);
		canvasEl.height = Math.floor(window.innerHeight * resScale);
		gl?.viewport(0, 0, canvasEl.width, canvasEl.height);
	};

	initWebGL(canvasEl);
	resize();
	window.addEventListener('resize', resize);

	let raf: number;
	let lastFrame = 0;
	const TARGET_MS = 1000 / 30; // 30fps cap
	const startTime = performance.now();

	const render = (now: number) => {
		// Throttle to 30fps — save GPU cycles for 24/7 Pi deployment
		if (now - lastFrame < TARGET_MS) {
			raf = requestAnimationFrame(render);
			return;
		}
		lastFrame = now;

		if (!gl || !program || !canvasEl) {
			raf = requestAnimationFrame(render);
			return;
		}

		untrack(() => {
			const t = (now - startTime) / 1000;

			// Weather darkness: 0=clear, 1=storm
			const weatherDark = weather === 'storm' ? 1.0 : weather === 'rain' ? 0.7 : weather === 'overcast' ? 0.4 : weather === 'cloudy' ? 0.2 : 0.0;

			gl!.clearColor(0, 0, 0, 0);
			gl!.clear(gl!.COLOR_BUFFER_BIT);

			gl!.uniform1f(uTime, t);
			gl!.uniform1f(uHeading, heading);
			gl!.uniform1f(uSpeed, speed);
			gl!.uniform1f(uDensity, density);
			gl!.uniform1f(uNightFactor, nightFactor);
			gl!.uniform1f(uAltitude, altitude);
			gl!.uniform1f(uCloudScale, cloudScale);
			gl!.uniform1f(uWeatherDark, weatherDark);
			gl!.uniform2f(uResolution, canvasEl!.width, canvasEl!.height);

			gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
		});

		raf = requestAnimationFrame(render);
	};

	raf = requestAnimationFrame(render);

	return () => {
		cancelAnimationFrame(raf);
		window.removeEventListener('resize', resize);
		if (gl) {
			gl.getExtension('WEBGL_lose_context')?.loseContext();
			gl = null;
		}
	};
});
</script>

<canvas
	bind:this={canvasEl}
	class="webgl-clouds"
	aria-hidden="true"
></canvas>

<style>
	.webgl-clouds {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 5;
		/* CSS scales half-res canvas to fullscreen — bilinear filtering
		   gives free anti-aliasing, perfect for soft cloud edges */
		image-rendering: auto;
	}
</style>
