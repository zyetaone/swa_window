<script lang="ts">
	/**
	 * NightMaskLayer — GPU composite of VIIRS × CartoDB for city light emission.
	 *
	 * Concept: VIIRS luminance masks CartoDB emission. Bright VIIRS (city) lets
	 * CartoDB warm street glow pass through. Dark VIIRS (terrain) multiplies CartoDB
	 * to black. Result: production-quality city lighting driven by real NASA data,
	 * without pixelated raster showing directly.
	 *
	 * Composite: multiply → warm hue shift → emissive boost.
	 */

	import { CustomLayer } from 'svelte-maplibre-gl';
	import maplibregl from 'maplibre-gl';

	let { nightFactor = 0 }: { nightFactor?: number } = $props();

	const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

	const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform float u_nightFactor;
uniform sampler2D u_viirs;
uniform sampler2D u_carto;

void main() {
  vec4 viirs = texture2D(u_viirs, v_uv);
  vec4 carto  = texture2D(u_carto, v_uv);

  float lum = dot(viirs.rgb, vec3(0.2126, 0.7152, 0.0722));
  float cartoLum = dot(carto.rgb, vec3(0.2126, 0.7152, 0.0722));

  // Mask: bright VIIRS = city light → pass CartoDB through.
  // Dark terrain → multiply CartoDB to black.
  // Fallback to CartoDB luminance if VIIRS not yet loaded.
  float mask = (lum > 0.01)
    ? smoothstep(0.04, 0.6, lum)
    : smoothstep(0.03, 0.4, cartoLum);

  vec3 rgb = carto.rgb * mask;

  // Warm hue shift — 25° on brightest (city-center) pixels
  float angle = mask * 0.44;
  float c = cos(angle), s = sin(angle);
  mat3 rot = mat3(
    0.213 + c*0.787 - s*0.213,  0.213 - c*0.213 + s*0.143,  0.213 - c*0.213 - s*0.787,
    0.715 - c*0.715 - s*0.715,  0.715 + c*0.285 + s*0.140,  0.715 - c*0.715 + s*0.715,
    0.072 - c*0.072 + s*0.283,  0.072 - c*0.072 - s*0.140,  0.072 + c*0.928 + s*0.072
  );
  rgb = rot * rgb;

  // Emissive boost — city pixels glow, not just reflect
  rgb *= 1.0 + mask * u_nightFactor * 2.4;

  // Night fade-in
  float fade = smoothstep(0.15, 0.85, u_nightFactor);
  float alpha = mask * fade * 0.92;

  gl_FragColor = vec4(rgb * alpha, alpha);
}`;

	let glProgram: WebGLProgram | null = null;
	let quadVBO: WebGLBuffer | null = null;
	let uLoc: Record<string, WebGLUniformLocation | null> = {};
	let startTime = 0;
	let mapRef: maplibregl.Map | null = null;

	const tileCache = new Map<string, { canvas: HTMLCanvasElement; ts: number }>();
	const CACHE_MAX_MS = 4000;

	async function loadTile(url: string): Promise<HTMLCanvasElement | null> {
		const cached = tileCache.get(url);
		if (cached && Date.now() - cached.ts < CACHE_MAX_MS) return cached.canvas;
		try {
			const resp = await fetch(url);
			if (!resp.ok) return null;
			const blob = await resp.blob();
			const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
			const canvas = document.createElement('canvas');
			canvas.width = bmp.width; canvas.height = bmp.height;
			canvas.getContext('2d')!.drawImage(bmp, 0, 0);
			bmp.close();
			tileCache.set(url, { canvas, ts: Date.now() });
			return canvas;
		} catch { return null; }
	}

	function tileUrl(z: number, x: number, y: number, source: 'viirs' | 'carto'): string {
		if (source === 'viirs') {
			const vz = Math.min(8, z);
			return `https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${vz}/${y}/${x}.png`;
		}
		return `https://basemaps.cartocdn.com/dark_nolabels/${z}/${x}/${y}.png`;
	}

	const impl: Omit<maplibregl.CustomLayerInterface, 'id' | 'type'> = {
		renderingMode: '2d',

		onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
			mapRef = map;

			const vs = gl.createShader(gl.VERTEX_SHADER)!;
			gl.shaderSource(vs, VERT);
			gl.compileShader(vs);

			const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
			gl.shaderSource(fs, FRAG);
			gl.compileShader(fs);

			glProgram = gl.createProgram()!;
			gl.attachShader(glProgram, vs);
			gl.attachShader(glProgram, fs);
			gl.linkProgram(glProgram);

			['u_viirs', 'u_carto', 'u_nightFactor', 'u_time'].forEach(n => {
				uLoc[n] = gl.getUniformLocation(glProgram!, n);
			});

			quadVBO = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

			startTime = performance.now();
		},

		async render(gl: WebGLRenderingContext) {
			if (!glProgram || !quadVBO || !mapRef) return;

			const nf = (this as any).nightFactor ?? nightFactor;
			if (nf < 0.1) { mapRef.triggerRepaint(); return; }

			const zoom = Math.floor(mapRef.getZoom());
			const c = mapRef.getCenter();
			const n2 = Math.pow(2, zoom);
			const x = Math.floor((c.lng + 180) / 360 * n2);
			const y = Math.floor((1 - Math.log(Math.tan(c.lat * Math.PI / 180) + 1 / Math.cos(c.lat * Math.PI / 180)) / Math.PI) / 2 * n2);

			const [viirsCanvas, cartoCanvas] = await Promise.all([
				loadTile(tileUrl(zoom, x, y, 'viirs')),
				loadTile(tileUrl(zoom, x, y, 'carto')),
			]);

			if (!viirsCanvas || !cartoCanvas) { mapRef.triggerRepaint(); return; }

			const viirsTex = gl.createTexture();
			const cartoTex  = gl.createTexture();

			const upload = (t: WebGLTexture, cv: HTMLCanvasElement) => {
				gl.bindTexture(gl.TEXTURE_2D, t);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			};
			upload(viirsTex, viirsCanvas);
			upload(cartoTex, cartoCanvas);

			gl.useProgram(glProgram);

			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, viirsTex);
			gl.uniform1i(uLoc['u_viirs'], 0);

			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, cartoTex);
			gl.uniform1i(uLoc['u_carto'], 1);

			gl.uniform1f(uLoc['u_nightFactor'], nf);
			gl.uniform1f(uLoc['u_time'], (performance.now() - startTime) / 1000);

			gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
			const aLoc = gl.getAttribLocation(glProgram, 'a_pos');
			gl.enableVertexAttribArray(aLoc);
			gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			gl.disableVertexAttribArray(aLoc);

			gl.deleteTexture(viirsTex);
			gl.deleteTexture(cartoTex);

			mapRef.triggerRepaint();
		},

		onRemove() { mapRef = null; },
	};
</script>

<CustomLayer implementation={impl} />