<script lang="ts">
	/**
	 * NightLightLayer — GeoJSON-masked VIIRS city light composite.
	 *
	 * Fix: NightMaskLayer had broken footprint rasterization (512×512 canvas
	 * with no geographic projection → screen UVs don't align with lng/lat coords).
	 *
	 * New approach: draw footprint GeoJSON to a canvas using geographic coordinates
	 * (lng/lat → pixel via bounding box), upload as a repeating texture. Shader
	 * converts screen UV → geographic UV → samples footprint correctly.
	 * Redraws when viewport moves.
	 */

	import { CustomLayer, GeoJSONSource, FillLayer } from 'svelte-maplibre-gl';
	import maplibregl from 'maplibre-gl';
	import { footprintsFor } from '../lib/urban-footprints';

	let {
		timeOfDay = 12,
		locationId = 'dubai',
	}: {
		timeOfDay?: number;
		locationId?: string;
	} = $props();

	// ── Luminance state ─────────────────────────────────────────────────────
	const nightFactor = $derived(
		timeOfDay >= 7 && timeOfDay <= 18 ? 0
		: timeOfDay < 5 || timeOfDay > 22 ? 1
		: timeOfDay < 7 ? 1 - (timeOfDay - 5) / 2
		: (timeOfDay - 18) / 4
	);

	const dawnDuskFactor = $derived.by(() => {
		const t = timeOfDay;
		if (t >= 7 && t <= 18) return 0;
		if (t < 5 || t > 22) return 0;
		if (t < 7) return (t - 5) / 2;
		if (t > 18) return (22 - t) / 4;
		return 0;
	});

	// GeoJSON for current location
	const geojson = $derived(footprintsFor(locationId as Parameters<typeof footprintsFor>[0]));

	// ── Shaders ─────────────────────────────────────────────────────────────
	const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

	// Footprint texture sampled by geographic UV (not screen UV).
	// geoBounds: [minLon, maxLon, minLat, maxLat] in geographic coords.
	// Repeating texture so we can sample correctly as viewport moves.
	const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform float u_nightFactor;
uniform float u_dawnDuskFactor;
uniform sampler2D u_footprint;
uniform sampler2D u_viirs;
uniform vec4 u_geoBounds; // minLon, maxLon, minLat, maxLat

void main() {
  vec4 viirs = texture2D(u_viirs, v_uv);

  // Convert screen UV → geographic UV → sample footprint
  float geoU = mix(u_geoBounds[0], u_geoBounds[1], v_uv.x);
  float geoV = mix(u_geoBounds[2], u_geoBounds[3], v_uv.y);
  vec4 fp = texture2D(u_footprint, vec2(geoU, geoV));

  float fpMask = fp.a / 255.0;
  float lum = dot(viirs.rgb, vec3(0.2126, 0.7152, 0.0722));

  float cityLight = fpMask * smoothstep(0.03, 0.5, lum);
  vec3 rgb = viirs.rgb * cityLight;

  float angle = cityLight * 0.5;
  float c = cos(angle), s = sin(angle);
  mat3 rot = mat3(
    0.213 + c*0.787 - s*0.213,  0.213 - c*0.213 + s*0.143,  0.213 - c*0.213 - s*0.787,
    0.715 - c*0.715 - s*0.715,  0.715 + c*0.285 + s*0.140,  0.715 - c*0.715 + s*0.715,
    0.072 - c*0.072 + s*0.283,  0.072 - c*0.072 - s*0.140,  0.072 + c*0.928 + s*0.072
  );
  rgb = rot * rgb;
  rgb *= 1.0 + cityLight * u_nightFactor * 2.8;

  float rimX = 1.0 - v_uv.x;
  float rim = rimX * u_dawnDuskFactor * 0.22;
  vec3 warmRim = vec3(1.0, 0.68, 0.28) * rim;
  rgb += warmRim * (1.0 - u_nightFactor);

  float fade = smoothstep(0.15, 0.85, u_nightFactor);
  float alpha = cityLight * fade * 0.95;

  gl_FragColor = vec4(rgb * alpha, alpha);
}`;

	// ── Layer state ─────────────────────────────────────────────────────────
	let glProgram: WebGLProgram | null = null;
	let quadVBO: WebGLBuffer | null = null;
	let uLoc: Record<string, WebGLUniformLocation | null> = {};
	let startTime = 0;
	let mapRef: maplibregl.Map | null = null;
	let fpCanvas: HTMLCanvasElement | null = null;

	const tileCache = new Map<string, { canvas: HTMLCanvasElement; ts: number }>();
	const CACHE_MAX_MS = 5000;

	// Compute geographic bounds from GeoJSON features
	function geoBounds(fc: GeoJSON.FeatureCollection): [number, number, number, number] {
		let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
		for (const feat of fc.features) {
			if (feat.geometry.type === 'Polygon') {
				for (const ring of feat.geometry.coordinates) {
					for (const [lon, lat] of ring) {
						if (lon < minLon) minLon = lon;
						if (lon > maxLon) maxLon = lon;
						if (lat < minLat) minLat = lat;
						if (lat > maxLat) maxLat = lat;
					}
				}
			}
		}
		return [minLon, maxLon, minLat, maxLat];
	}

	// Draw footprint GeoJSON onto canvas using geographic coordinates
	// Canvas spans [minLon..maxLon] × [minLat..maxLat]
	function drawFootprint(
		fc: GeoJSON.FeatureCollection,
		bounds: [number, number, number, number],
		canvas: HTMLCanvasElement
	): void {
		const ctx = canvas.getContext('2d')!;
		const [minLon, maxLon, minLat, maxLat] = bounds;
		const W = canvas.width, H = canvas.height;

		ctx.clearRect(0, 0, W, H);

		for (const feat of fc.features) {
			if (feat.geometry.type !== 'Polygon') continue;
			const glow = (feat.properties?.glowIntensity ?? 0.5) as number;
			const kind = feat.properties?.kind as string;
			const alpha = Math.round(glow * 255);

			const r = 255;
			const g = Math.round(200 + glow * 55);
			const b = Math.round(100 + glow * 80);
			ctx.fillStyle = `rgba(${r},${g},${b},${alpha / 255})`;
			ctx.strokeStyle = `rgba(255,180,80,${alpha * 0.5 / 255})`;
			ctx.lineWidth = 1;

			for (const ring of feat.geometry.coordinates) {
				if (ring.length < 3) continue;

				ctx.beginPath();
				for (let i = 0; i < ring.length; i++) {
					const [lon, lat] = ring[i];
					const x = ((lon - minLon) / (maxLon - minLon)) * W;
					const y = H - ((lat - minLat) / (maxLat - minLat)) * H;
					if (i === 0) ctx.moveTo(x, y);
					else ctx.lineTo(x, y);
				}
				ctx.closePath();

				if (kind === 'cbd' || kind === 'sub_center') {
					ctx.shadowColor = `rgba(255,160,60,${alpha * 0.4 / 255})`;
					ctx.shadowBlur = 8;
				} else {
					ctx.shadowBlur = 0;
				}

				ctx.fill();
				ctx.stroke();
			}
		}
	}

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

	function viirsUrl(z: number, x: number, y: number): string {
		const vz = Math.min(8, z);
		return `https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${vz}/${y}/${x}.png`;
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

			['u_footprint', 'u_viirs', 'u_nightFactor', 'u_dawnDuskFactor', 'u_time', 'u_geoBounds'].forEach(n => {
				uLoc[n] = gl.getUniformLocation(glProgram!, n);
			});

			quadVBO = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

			// Pre-rasterize footprint canvas
			const bounds = geoBounds(geojson);
			fpCanvas = document.createElement('canvas');
			fpCanvas.width = 512; fpCanvas.height = 512;
			drawFootprint(geojson, bounds, fpCanvas);

			startTime = performance.now();

			// Re-rasterize footprint when map stops moving
			const redrawFootprint = () => {
				if (!mapRef) return;
				const b = geoBounds(geojson);
				if (fpCanvas) drawFootprint(geojson, b, fpCanvas);
			};
			mapRef.on('idle', redrawFootprint);
		},

		async render(gl: WebGLRenderingContext) {
			if (!glProgram || !quadVBO || !mapRef || !fpCanvas) return;

			if (nightFactor < 0.1) { mapRef.triggerRepaint(); return; }

			const zoom = Math.floor(mapRef.getZoom());
			const c = mapRef.getCenter();
			const n2 = Math.pow(2, zoom);
			const x = Math.floor((c.lng + 180) / 360 * n2);
			const y = Math.floor((1 - Math.log(Math.tan(c.lat * Math.PI / 180) + 1 / Math.cos(c.lat * Math.PI / 180)) / Math.PI) / 2 * n2);

			const viirsCanvas = await loadTile(viirsUrl(zoom, x, y));
			if (!viirsCanvas) { mapRef.triggerRepaint(); return; }

			const bounds = geoBounds(geojson);

			// Upload footprint texture with REPEAT wrapping
			const fpTex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, fpTex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fpCanvas);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

			const viirsTex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, viirsTex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, viirsCanvas);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

			gl.useProgram(glProgram);

			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, fpTex);
			gl.uniform1i(uLoc['u_footprint'], 0);

			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, viirsTex);
			gl.uniform1i(uLoc['u_viirs'], 1);

			gl.uniform1f(uLoc['u_nightFactor'], nightFactor);
			gl.uniform1f(uLoc['u_dawnDuskFactor'], dawnDuskFactor);
			gl.uniform1f(uLoc['u_time'], (performance.now() - startTime) / 1000);
			gl.uniform4f(uLoc['u_geoBounds'], bounds[0], bounds[1], bounds[2], bounds[3]);

			gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
			const aLoc = gl.getAttribLocation(glProgram, 'a_pos');
			gl.enableVertexAttribArray(aLoc);
			gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			gl.disableVertexAttribArray(aLoc);

			gl.deleteTexture(fpTex);
			gl.deleteTexture(viirsTex);

			mapRef.triggerRepaint();
		},

		onRemove() { mapRef = null; },
	};
</script>

<!-- Visual footprint layer — MapLibre renders GeoJSON with correct geographic
     projection. Warm amber fill shows urban extent without custom rasterization. -->
{#if nightFactor > 0.15}
	<GeoJSONSource id="footprints" data={geojson}>
		<FillLayer
			id="footprint-fill"
			source="footprints"
			paint={{
				'fill-color': [
					'match', ['get', 'kind'],
					'cbd',         `rgba(255, 180, 80, ${nightFactor * 0.8})`,
					'sub_center',  `rgba(255, 160, 70, ${nightFactor * 0.65})`,
					'infra',       `rgba(255, 150, 60, ${nightFactor * 0.55})`,
					'urban_extent', `rgba(255, 140, 50, ${nightFactor * 0.45})`,
					/* default */  `rgba(200, 120, 40, ${nightFactor * 0.3})`,
				],
				'fill-opacity': 0.2 + nightFactor * 0.2,
			}}
		/>
	</GeoJSONSource>
{/if}

<!-- GPU composite: geographic UV footprint mask × VIIRS → warm city glow -->
<CustomLayer implementation={impl} />