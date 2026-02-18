/**
 * Texture Generation Script
 *
 * Generates seamless tileable noise/cloud textures for the aero-window project.
 * Uses Google GenAI (Imagen 3) for AI generation with a programmatic Perlin/Worley
 * noise fallback when AI is unavailable or fails.
 *
 * Usage: npx tsx scripts/generate-textures.ts [--fallback-only]
 */

import { GoogleGenAI } from '@google/genai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

// .env is loaded via --env-file=.env in the npm script

const OUTPUT_DIR = path.join(process.cwd(), 'static/textures');
const USE_FALLBACK_ONLY = process.argv.includes('--fallback-only');

interface TextureSpec {
	name: string;
	width: number;
	height: number;
	prompt: string;
	negativePrompt: string;
}

const TEXTURES: TextureSpec[] = [
	{
		name: 'cloud-noise.png',
		width: 512,
		height: 512,
		prompt:
			'seamless tileable perlin noise cloud pattern, grayscale, organic shapes, various density, white clouds on black background, abstract texture',
		negativePrompt: 'text, watermark, border, frame, people, objects'
	},
	{
		name: 'cloud-detail.png',
		width: 256,
		height: 256,
		prompt:
			'seamless tileable voronoi cellular noise pattern, grayscale, organic cell-like structures, soft edges, abstract texture',
		negativePrompt: 'text, watermark, border, frame, people, objects'
	},
	{
		name: 'cloud-wisp.png',
		width: 256,
		height: 256,
		prompt:
			'seamless tileable horizontal wispy cloud texture, grayscale, thin streaks, cirrus cloud pattern, abstract texture',
		negativePrompt: 'text, watermark, border, frame, people, objects'
	},
	{
		name: 'weather-map.png',
		width: 256,
		height: 256,
		prompt:
			'seamless tileable abstract cloud coverage map, grayscale, large soft blobs and clear patches, satellite weather view style, abstract texture',
		negativePrompt: 'text, watermark, border, frame, people, objects, land, ocean'
	}
];

// ---------------------------------------------------------------------------
// AI Generation (Imagen 3)
// ---------------------------------------------------------------------------

async function generateWithAI(spec: TextureSpec): Promise<Buffer | null> {
	const apiKey = process.env.GOOGLE_GENAI_API_KEY;
	if (!apiKey) {
		console.warn('  [AI] GOOGLE_GENAI_API_KEY not set, skipping AI generation');
		return null;
	}

	const ai = new GoogleGenAI({ apiKey });

	// Try Imagen 3 via generateImages
	const models = ['imagen-3.0-generate-002', 'imagen-3.0-generate-001'];

	for (const model of models) {
		try {
			console.log(`  [AI] Trying model: ${model}`);
			const response = await ai.models.generateImages({
				model,
				prompt: spec.prompt,
				config: {
					numberOfImages: 1,
					aspectRatio: spec.width === spec.height ? '1:1' : '16:9',
					outputMimeType: 'image/png'
				}
			});

			const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
			if (imageBytes) {
				console.log(`  [AI] Success with ${model}`);
				return Buffer.from(imageBytes, 'base64');
			}
			console.warn(`  [AI] ${model} returned no image data`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`  [AI] ${model} failed: ${msg}`);
		}
	}

	// Try Gemini native image generation via generateContent with response_modalities
	try {
		const geminiModel = 'gemini-2.0-flash';
		console.log(`  [AI] Trying generateContent with ${geminiModel} (response_modalities: image)`);
		const response = await ai.models.generateContent({
			model: geminiModel,
			contents: spec.prompt,
			config: {
				responseModalities: ['image']
			}
		});

		const parts = response.candidates?.[0]?.content?.parts;
		if (parts) {
			for (const part of parts) {
				if (part.inlineData?.data) {
					console.log(`  [AI] Success with ${geminiModel} generateContent`);
					return Buffer.from(part.inlineData.data, 'base64');
				}
			}
		}
		console.warn(`  [AI] ${geminiModel} generateContent returned no image`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`  [AI] Gemini generateContent failed: ${msg}`);
	}

	return null;
}

// ---------------------------------------------------------------------------
// Programmatic Fallback — Perlin & Worley Noise
// ---------------------------------------------------------------------------

// Permutation table for Perlin noise (doubled to avoid wrapping)
function buildPermTable(): number[] {
	const p = Array.from({ length: 256 }, (_, i) => i);
	// Fisher-Yates shuffle with fixed seed for reproducibility
	let seed = 42;
	const rng = () => {
		seed = (seed * 16807 + 0) % 2147483647;
		return (seed - 1) / 2147483646;
	};
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[p[i], p[j]] = [p[j], p[i]];
	}
	return [...p, ...p];
}

const PERM = buildPermTable();

function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
	return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
	const h = hash & 3;
	const u = h < 2 ? x : y;
	const v = h < 2 ? y : x;
	return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlinNoise(x: number, y: number): number {
	const X = Math.floor(x) & 255;
	const Y = Math.floor(y) & 255;
	const xf = x - Math.floor(x);
	const yf = y - Math.floor(y);
	const u = fade(xf);
	const v = fade(yf);

	const aa = PERM[PERM[X] + Y];
	const ab = PERM[PERM[X] + Y + 1];
	const ba = PERM[PERM[X + 1] + Y];
	const bb = PERM[PERM[X + 1] + Y + 1];

	return lerp(lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u), lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u), v);
}

function fbm(x: number, y: number, octaves: number, lacunarity: number, gain: number): number {
	let value = 0;
	let amplitude = 1;
	let frequency = 1;
	let maxAmp = 0;
	for (let i = 0; i < octaves; i++) {
		value += amplitude * perlinNoise(x * frequency, y * frequency);
		maxAmp += amplitude;
		amplitude *= gain;
		frequency *= lacunarity;
	}
	return value / maxAmp;
}

function worleyNoise(x: number, y: number, cellCount: number, seed: number): number {
	const rng = (s: number) => {
		s = ((s * 1103515245 + 12345) & 0x7fffffff) >>> 0;
		return s / 0x7fffffff;
	};

	const cellX = Math.floor(x * cellCount);
	const cellY = Math.floor(y * cellCount);
	let minDist = Infinity;

	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			const cx = ((cellX + dx) % cellCount + cellCount) % cellCount;
			const cy = ((cellY + dy) % cellCount + cellCount) % cellCount;
			const hash = cx * 7919 + cy * 104729 + seed;
			const px = (cx + rng(hash)) / cellCount;
			const py = (cy + rng(hash * 2 + 1)) / cellCount;

			// Handle wrapping for seamless tiling
			for (let wx = -1; wx <= 1; wx++) {
				for (let wy = -1; wy <= 1; wy++) {
					const ddx = x - (px + wx);
					const ddy = y - (py + wy);
					const dist = Math.sqrt(ddx * ddx + ddy * ddy);
					if (dist < minDist) minDist = dist;
				}
			}
		}
	}

	return Math.min(minDist * cellCount * 0.7, 1);
}

/**
 * Generate a grayscale pixel buffer using procedural noise.
 * Returns 1 byte per pixel (grayscale).
 */
function generateProceduralTexture(spec: TextureSpec): Buffer {
	const { width, height, name } = spec;
	const pixels = Buffer.alloc(width * height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const u = x / width;
			const v = y / height;
			let value: number;

			if (name === 'cloud-noise.png') {
				// Fractal Brownian Motion for main cloud shapes
				const n = fbm(u * 4, v * 4, 6, 2.0, 0.5);
				value = Math.max(0, Math.min(1, (n + 1) * 0.5));
				value = Math.pow(value, 0.8);
			} else if (name === 'cloud-detail.png') {
				// Inverted Worley noise for cellular/cumulus detail
				const w = worleyNoise(u, v, 8, 12345);
				value = 1 - w;
				value = Math.pow(value, 1.5);
			} else if (name === 'cloud-wisp.png') {
				// Stretched noise for cirrus wisps — elongated in X
				const n = fbm(u * 8, v * 2, 5, 2.0, 0.5);
				value = Math.max(0, Math.min(1, (n + 1) * 0.5));
				value = Math.pow(value, 1.2);
			} else {
				// weather-map: Large-scale blobs
				const n = fbm(u * 2, v * 2, 3, 2.0, 0.6);
				value = Math.max(0, Math.min(1, (n + 1) * 0.5));
				value = value * value * (3 - 2 * value);
			}

			pixels[y * width + x] = Math.round(value * 255);
		}
	}

	return pixels;
}

// ---------------------------------------------------------------------------
// PNG Encoder — Grayscale PNG with zlib compression (node:zlib)
// ---------------------------------------------------------------------------

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc ^= data[i];
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function encodePNG(width: number, height: number, grayscale: Buffer): Buffer {
	const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

	function makeChunk(type: string, data: Uint8Array): Buffer {
		const buf = Buffer.alloc(4 + 4 + data.length + 4);
		buf.writeUInt32BE(data.length, 0);
		buf.write(type, 4, 4, 'ascii');
		Buffer.from(data).copy(buf, 8);
		const crcData = Buffer.alloc(4 + data.length);
		crcData.write(type, 0, 4, 'ascii');
		Buffer.from(data).copy(crcData, 4);
		buf.writeUInt32BE(crc32(crcData), 8 + data.length);
		return buf;
	}

	// IHDR: 8-bit grayscale
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 0; // color type: Grayscale
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	// IDAT — grayscale data with filter bytes, zlib-compressed
	const rowSize = width + 1; // +1 for filter byte per row
	const rawData = Buffer.alloc(height * rowSize);
	for (let y = 0; y < height; y++) {
		rawData[y * rowSize] = 0; // filter: None
		grayscale.copy(rawData, y * rowSize + 1, y * width, (y + 1) * width);
	}
	const compressed = zlib.deflateSync(rawData, { level: 9 });

	return Buffer.concat([
		pngSignature,
		makeChunk('IHDR', ihdr),
		makeChunk('IDAT', compressed),
		makeChunk('IEND', Buffer.alloc(0))
	]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log('=== Aero Window Texture Generator ===\n');
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	if (USE_FALLBACK_ONLY) {
		console.log('Mode: --fallback-only (skipping AI generation)\n');
	}

	for (const spec of TEXTURES) {
		const outPath = path.join(OUTPUT_DIR, spec.name);
		console.log(`Generating: ${spec.name} (${spec.width}x${spec.height})`);

		let saved = false;

		// Try AI generation first (unless fallback-only mode)
		if (!USE_FALLBACK_ONLY) {
			try {
				const aiBuffer = await generateWithAI(spec);
				if (aiBuffer && aiBuffer.length > 100) {
					fs.writeFileSync(outPath, aiBuffer);
					console.log(`  Saved (AI): ${outPath} (${(aiBuffer.length / 1024).toFixed(1)} KB)`);
					saved = true;
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`  AI generation error: ${msg}`);
			}
		}

		// Fallback to procedural generation
		if (!saved) {
			console.log('  [Fallback] Generating procedural texture...');
			const pixels = generateProceduralTexture(spec);
			const png = encodePNG(spec.width, spec.height, pixels);
			fs.writeFileSync(outPath, png);
			console.log(`  Saved (procedural): ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
		}

		console.log('');
	}

	// Verify all files exist
	console.log('=== Verification ===');
	let allGood = true;
	for (const spec of TEXTURES) {
		const outPath = path.join(OUTPUT_DIR, spec.name);
		if (fs.existsSync(outPath)) {
			const stat = fs.statSync(outPath);
			console.log(`  OK: ${spec.name} (${(stat.size / 1024).toFixed(1)} KB)`);
		} else {
			console.error(`  MISSING: ${spec.name}`);
			allGood = false;
		}
	}

	if (allGood) {
		console.log('\nAll textures generated successfully!');
	} else {
		console.error('\nSome textures are missing!');
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
