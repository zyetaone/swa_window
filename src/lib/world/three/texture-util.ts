/**
 * world/three/texture-util — procedural texture helpers shared by env
 * layers (SunGlow core/halo, Moon core/halo, LensFlare).
 *
 * Previously each component had its own copy of `makeRadialTexture` —
 * 4-way duplication of a 16-line helper. Centralised here so future tints,
 * filter modes, or device-pixel-ratio fixes land once.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

/**
 * Build a radial-gradient CanvasTexture from colour stops.
 *
 * @param stops Array of [position, cssColor] pairs, position 0..1.
 * @param size  Canvas dimension in pixels (default 256). Powers of 2 are
 *              friendliest for GPU mipmap chains but the textures we make
 *              with this are short-lived sprite maps where mipmaps don't
 *              matter much.
 *
 * Returned texture has:
 *   - colorSpace = SRGB  (so colours match the rest of the scene)
 *   - min/mag filter = Linear (no nearest-neighbour artefacts at edges)
 *   - needsUpdate = true (ready for immediate use)
 *
 * Caller owns disposal — call `.dispose()` on unmount.
 */
export function makeRadialTexture(
	stops: [number, string][],
	size = 256,
): CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const r = size / 2;
	const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
	for (const [pos, colour] of stops) grad.addColorStop(pos, colour);
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, size, size);
	const tex = new CanvasTexture(canvas);
	tex.colorSpace = SRGBColorSpace;
	tex.minFilter = LinearFilter;
	tex.magFilter = LinearFilter;
	tex.needsUpdate = true;
	return tex;
}
