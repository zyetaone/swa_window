import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import { encodeQr, qrSvg, QR_SIZE } from '#lib/qr.js';

/**
 * DECODED, not snapshotted.
 *
 * A hand-written QR encoder fails in a way that inspection cannot catch: the
 * first draft here used 55 data codewords (the v3-L figure) instead of v3-M's
 * 44, and produced a grid with perfect finder patterns, correct timing, a
 * correct alignment block and a plausible-looking data field that no reader on
 * earth could decode. A snapshot test would have frozen that and called it
 * passing.
 *
 * So every assertion below runs the output through `jsqr`, an independent
 * implementation, and checks the string that comes back out.
 */
function decode(text: string, scale = 8, quiet = 4): string | null {
	const { size, modules } = encodeQr(text);
	const dim = (size + quiet * 2) * scale;
	const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (!modules[y * size + x]) continue;
			for (let dy = 0; dy < scale; dy++) {
				for (let dx = 0; dx < scale; dx++) {
					const px = ((y + quiet) * scale + dy) * dim + ((x + quiet) * scale + dx);
					data[px * 4] = 0;
					data[px * 4 + 1] = 0;
					data[px * 4 + 2] = 0;
				}
			}
		}
	}
	return jsQR(data, dim, dim)?.data ?? null;
}

describe('qr encoder', () => {
	it('round-trips the admin URL a kiosk would show', () => {
		const url = 'http://192.168.31.128:5173/admin';
		expect(decode(url)).toBe(url);
	});

	/**
	 * The widest URL this can ever be handed. If the longest possible IPv4 and
	 * port still fit and still scan, no real device can overflow it.
	 */
	it('round-trips the longest realistic address', () => {
		const url = 'http://255.255.255.255:65535/admin';
		expect(decode(url)).toBe(url);
	});

	it('round-trips a hostname form', () => {
		const url = 'http://aero-display-00.local:5173/admin';
		expect(decode(url)).toBe(url);
	});

	it('is 29 modules square, as version 3 requires', () => {
		expect(QR_SIZE).toBe(29);
		expect(encodeQr('http://10.0.0.1:5173/admin').modules.length).toBe(29 * 29);
	});

	/**
	 * Refuses rather than truncates.
	 *
	 * A code that scans to a shortened URL sends a field tech to the wrong place
	 * — or to nothing — and looks like it worked. Failing loudly is the only
	 * honest option, and the caller shows a plain-text address instead.
	 */
	it('throws on a payload it cannot hold', () => {
		expect(() => encodeQr('x'.repeat(43))).toThrow(/exceeds/);
	});

	it('emits an SVG with a quiet zone and no external references', () => {
		const svg = qrSvg('http://10.0.0.1:5173/admin');
		expect(svg).toContain('viewBox="0 0 37 37"'); // 29 + 4 + 4
		expect(svg).toContain('shape-rendering="crispEdges"');
		expect(svg).not.toContain('http://www.w3.org/1999/xlink');
	});
});
