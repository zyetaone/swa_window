import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { FlightTrack, ORBIT_PERIOD_SEC } from '../../src/lib/display/flight/flight-path.js';
const M = 111_320;
const bearing = (a: number, b: number, c: number, d: number) => {
	const dN = (c - a) * M;
	const dE = (d - b) * M * Math.cos((a * Math.PI) / 180);
	return ((Math.atan2(dE, dN) * 180) / Math.PI + 360) % 360;
};
const norm = (d: number) => (((d % 360) + 540) % 360) - 180;
const out: string[] = [];
it('math', () => {
	for (const [name, lat, lon] of [
		['hyderabad', 17.44, 78.38],
		['denver', 39.86, -104.67],
		['chicago', 41.79, -87.75]
	] as const) {
		const t = new FlightTrack(lat, lon, 400, 12000, 1, 0);
		let mx = 0,
			su = 0,
			n = 0;
		const rows: string[] = [];
		for (let i = 0; i < 24; i++) {
			const s = (i * ORBIT_PERIOD_SEC) / 24;
			const p0 = t.poseAt(s - 0.5),
				p1 = t.poseAt(s + 0.5),
				p = t.poseAt(s);
			const th = bearing(p0.lat, p0.lon, p1.lat, p1.lon);
			const e = Math.abs(norm(p.headingDeg - th));
			mx = Math.max(mx, e);
			su += e;
			n++;
			if (name === 'denver')
				rows.push(
					`  ${String(Math.round((i / 24) * 360)).padStart(3)}   rep ${p.headingDeg.toFixed(1).padStart(6)}  act ${th.toFixed(1).padStart(6)}  err ${e.toFixed(1).padStart(5)}  bank ${(p.bankDeg ?? 0).toFixed(1).padStart(6)}`
				);
		}
		out.push(
			`\n=== ${name} cosLat=${Math.cos((lat * Math.PI) / 180).toFixed(3)} :: heading err mean ${(su / n).toFixed(1)} MAX ${mx.toFixed(1)} deg`
		);
		if (name === 'denver') out.push(rows.join('\n'));
	}
	writeFileSync('/tmp/math.out', out.join('\n'));
});
