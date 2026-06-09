/**
 * extract-wing.ts — headless extraction of the SW 737 wings from the full
 * model into small standalone GLBs.
 *
 *   right wing (+X) → static/models/wing.glb
 *   left  wing (−X) → static/models/wing-left.glb
 *
 * Both are the real model geometry (watertight, readable "Southwest.com"
 * livery on each engine). Wing.svelte loads both and shows whichever one
 * trails the current orbit direction, so the wing always reads correctly
 * whichever way the flight runs — without mirroring (which would reverse the
 * livery text).
 *
 * Each wing is recentered to the origin and scaled so its longest axis is
 * TARGET_DIM units, matching what Wing.svelte's WING_SCALE expects.
 *
 * Usage: bun scripts/extract-wing.ts
 *
 * Region is in the model's native glTF world frame: X = wingspan (fuselage at
 * X≈0), Z = fore/aft (tailplane is the cz ≈ −7050 outlier we exclude).
 */
import { NodeIO } from '@gltf-transform/core';
import { getBounds, prune } from '@gltf-transform/functions';

const SRC = 'static/models/southwest-737/scene.gltf';
const X_MIN = 250; // |x| floor: wing/engine/winglet sit well off the centreline
const Z_MIN = -6500; // exclude the tailplane outlier
const TARGET_DIM = 17; // normalized longest-axis span (Wing.svelte WING_SCALE basis)

async function extract(side: 'right' | 'left', out: string): Promise<void> {
	const io = new NodeIO();
	const doc = await io.read(SRC);
	const root = doc.getRoot();
	const meshNodes = root.listNodes().filter((n) => n.getMesh());

	let kept = 0;
	for (const n of meshNodes) {
		const b = getBounds(n);
		const cx = (b.min[0] + b.max[0]) / 2;
		const cz = (b.min[2] + b.max[2]) / 2;
		const inSide = side === 'right' ? cx > X_MIN : cx < -X_MIN;
		if (inSide && cz > Z_MIN) kept++;
		else n.dispose();
	}
	await doc.transform(prune());

	// Recenter to origin + scale longest axis to TARGET_DIM via a wrapper node.
	const scene = root.listScenes()[0];
	const wb = getBounds(scene);
	const center = [
		(wb.min[0] + wb.max[0]) / 2,
		(wb.min[1] + wb.max[1]) / 2,
		(wb.min[2] + wb.max[2]) / 2,
	];
	const dim = Math.max(wb.max[0] - wb.min[0], wb.max[1] - wb.min[1], wb.max[2] - wb.min[2]);
	const k = TARGET_DIM / dim;
	const wrapper = doc
		.createNode(`${side}_normalize`)
		.setScale([k, k, k])
		.setTranslation([-center[0] * k, -center[1] * k, -center[2] * k]);
	for (const child of scene.listChildren()) wrapper.addChild(child);
	scene.addChild(wrapper);

	await new NodeIO().write(out, doc);
	const a = getBounds(root.listScenes()[0]);
	console.log(
		`${side.padEnd(5)} kept ${kept} meshes → ${out}  ` +
			`x[${a.min[0].toFixed(1)}, ${a.max[0].toFixed(1)}] ` +
			`y[${a.min[1].toFixed(1)}, ${a.max[1].toFixed(1)}] ` +
			`z[${a.min[2].toFixed(1)}, ${a.max[2].toFixed(1)}]`,
	);
}

await extract('right', 'static/models/wing.glb');
await extract('left', 'static/models/wing-left.glb');
