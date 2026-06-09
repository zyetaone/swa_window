/**
 * extract-wing.ts — headless extraction of the SW 737 wings from the full
 * model into small standalone GLBs.
 *
 *   right wing (+X) → static/models/wing.glb
 *   left  wing (−X) → static/models/wing-left.glb
 *
 * ─── WHY TRIANGLE-CLIP, NOT NODE-FILTER ────────────────────────────────
 * The earlier version kept whole mesh NODES whose centroid sat off the
 * centreline (cx > 250). That silently DROPPED the wing's main upper skin:
 * meshes ni=229/230/231 are single primitives that span the FULL wingspan
 * (x ≈ −1647 … +1647, centroid ≈ 0) plus the fuselage — their centroid is
 * at the centreline, so the node filter discarded them and the extracted
 * wing had a missing/transparent top surface.
 *
 * The skin cannot be separated at node granularity. This version world-bakes
 * every mesh, then clips at the TRIANGLE level: keep a triangle when its
 * world centroid is outboard of the fuselage (|x| > X_CUT) and within the
 * wing chord band (Z_MIN < z < Z_MAX, which drops the tailplane + nose).
 * The right-wing half of the shared skin is preserved; the fuselage and the
 * opposite wing are cut away.
 *
 * The model has ZERO textures — every surface is a flat per-panel
 * baseColorFactor — so there is no livery text to reverse and the materials
 * survive the clip untouched (Wing.svelte flattens them to unlit MeshBasic).
 *
 * Each wing is then recentered to the origin and scaled so its longest axis
 * is TARGET_DIM units, matching Wing.svelte's WING_SCALE basis.
 *
 * Usage: bun scripts/extract-wing.ts
 *
 * Native glTF world frame: X = wingspan (fuselage at X≈0), Y = up,
 * Z = fore/aft (tailplane is the cz ≈ −7000 outlier we exclude via Z_MIN).
 */
import { NodeIO, type mat4, type Node } from '@gltf-transform/core';
import { getBounds, prune, transformPrimitive } from '@gltf-transform/functions';

const SRC = 'static/models/southwest-737/scene.gltf';
const X_CUT = 250; // OUTBOARD of the fuselage skin radius. 170 cut inside the
                   // fuselage, dragging in a long strip of body side-skin +
                   // cabin-window glass (Z-span 28-39 vs the wing's ~13). 250
                   // clears the fuselage, keeping the wing root onward.
const Z_MIN = -6000; // tightened: drop tailplane + aft belly/gear fore-aft slab
const Z_MAX = -4400; // tightened: drop the nose / forward fuselage + fairing
const TARGET_DIM = 17; // normalized longest-axis span (Wing.svelte WING_SCALE basis)

// ─── world-matrix helpers (column-major, glTF convention) ──────────────
const IDENT: mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: mat4, b: mat4): mat4 {
	const r = new Array(16).fill(0) as unknown as mat4;
	for (let c = 0; c < 4; c++)
		for (let row = 0; row < 4; row++)
			r[c * 4 + row] =
				a[row] * b[c * 4] +
				a[row + 4] * b[c * 4 + 1] +
				a[row + 8] * b[c * 4 + 2] +
				a[row + 12] * b[c * 4 + 3];
	return r;
}

/** Compose a node's local TRS into a column-major mat4. */
function localMatrix(n: Node): mat4 {
	const [tx, ty, tz] = n.getTranslation();
	const [x, y, z, w] = n.getRotation();
	const [sx, sy, sz] = n.getScale();
	const xx = x * x, yy = y * y, zz = z * z;
	const xy = x * y, xz = x * z, yz = y * z;
	const wx = w * x, wy = w * y, wz = w * z;
	return [
		(1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
		(2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
		(2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
		tx, ty, tz, 1,
	];
}

async function extract(side: 'right' | 'left', out: string): Promise<void> {
	const io = new NodeIO();
	const doc = await io.read(SRC);
	const root = doc.getRoot();
	const buffer = root.listBuffers()[0];

	// 1. World-bake every mesh's geometry, then flatten all node transforms to
	//    identity so the scene graph no longer re-applies them.
	const world = new Map<Node, mat4>();
	const walk = (n: Node, parent: mat4) => {
		const m = multiply(parent, localMatrix(n));
		world.set(n, m);
		for (const c of n.listChildren()) walk(c, m);
	};
	for (const scene of root.listScenes())
		for (const n of scene.listChildren()) walk(n, IDENT);

	for (const [n, m] of world) {
		const mesh = n.getMesh();
		if (mesh) for (const prim of mesh.listPrimitives()) transformPrimitive(prim, m);
	}
	for (const n of root.listNodes())
		n.setMatrix(IDENT).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);

	// 2. Triangle-clip every primitive to the wing half-space.
	const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
	let keptTris = 0;
	for (const mesh of root.listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute('POSITION');
			const idx = prim.getIndices();
			if (!pos || !idx) { prim.dispose(); continue; }
			const n = idx.getCount();
			const keep: number[] = [];
			for (let t = 0; t + 2 < n; t += 3) {
				const i0 = idx.getScalar(t), i1 = idx.getScalar(t + 1), i2 = idx.getScalar(t + 2);
				pos.getElement(i0, a); pos.getElement(i1, b); pos.getElement(i2, c);
				const cx = (a[0] + b[0] + c[0]) / 3;
				const cz = (a[2] + b[2] + c[2]) / 3;
				const inX = side === 'right' ? cx > X_CUT : cx < -X_CUT;
				if (inX && cz > Z_MIN && cz < Z_MAX) keep.push(i0, i1, i2);
			}
			if (keep.length === 0) { prim.dispose(); continue; }
			keptTris += keep.length / 3;
			prim.setIndices(
				doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(buffer),
			);
		}
	}
	await doc.transform(prune());

	// 3. Recenter to origin + scale longest axis to TARGET_DIM via a wrapper node.
	const scene = root.listScenes()[0];
	const wb = getBounds(scene);
	const center = [
		(wb.min[0] + wb.max[0]) / 2,
		(wb.min[1] + wb.max[1]) / 2,
		(wb.min[2] + wb.max[2]) / 2,
	];
	// Normalize on the SPAN (X) specifically, not the longest axis. The wing's
	// defining dimension is its span; keying off X keeps WING_SCALE stable
	// regardless of how much fore-aft engine/fairing extent the clip includes
	// (a longest-axis basis flipped to Z once the full skin was kept, which
	// silently rescaled the whole wing and broke the baked pose).
	const dim = wb.max[0] - wb.min[0];
	const k = TARGET_DIM / dim;
	const wrapper = doc
		.createNode(`${side}_normalize`)
		.setScale([k, k, k])
		.setTranslation([-center[0] * k, -center[1] * k, -center[2] * k]);
	for (const child of scene.listChildren()) wrapper.addChild(child);
	scene.addChild(wrapper);

	await new NodeIO().write(out, doc);
	const fin = getBounds(root.listScenes()[0]);
	console.log(
		`${side.padEnd(5)} ${keptTris} tris → ${out}  ` +
			`x[${fin.min[0].toFixed(1)}, ${fin.max[0].toFixed(1)}] ` +
			`y[${fin.min[1].toFixed(1)}, ${fin.max[1].toFixed(1)}] ` +
			`z[${fin.min[2].toFixed(1)}, ${fin.max[2].toFixed(1)}]`,
	);
}

await extract('right', 'static/models/wing.glb');
await extract('left', 'static/models/wing-left.glb');
