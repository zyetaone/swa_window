<script lang="ts" module>
	export interface ModelStats {
		meshes: number;
		triangles: number;
		dims: [number, number, number];
		materials: number;
	}

	export interface SelEntry {
		name: string;
		tris: number;
	}

	/**
	 * Shared controller — the page creates it as $state and passes it down.
	 * ModelView populates `selection` + the imperative methods; the page reads
	 * `selection` reactively and its buttons call the methods. This is the
	 * page ↔ in-Canvas bridge (the 3D logic must live inside <Canvas>, the UI
	 * outside it).
	 */
	export interface InspectorController {
		selection: SelEntry[];
		isolate?: () => void;
		hide?: () => void;
		showAll?: () => void;
		clear?: () => void;
	}
</script>

<script lang="ts">
	/**
	 * ModelView — the in-Canvas half of the model inspector. Loads the
	 * Southwest 737 GLTF, recenters + normalizes it, sets up an orbit camera +
	 * studio lighting, reports stats, and implements click-to-select with
	 * isolate/hide so the wing (or any part) can be found in the 500-mesh
	 * graph and its mesh names copied out for a Blender extraction.
	 *
	 * Selection highlight swaps a per-mesh material (originals kept in a
	 * WeakMap) rather than mutating `material.emissive` — the 36 materials are
	 * shared across the 500 meshes, so an in-place emissive edit would light
	 * up every mesh using that material, not just the clicked one.
	 */
	import { T, useThrelte } from '@threlte/core';
	import { useGltf, OrbitControls, Grid } from '@threlte/extras';
	import {
		Box3,
		Vector3,
		Vector2,
		Raycaster,
		MeshStandardMaterial,
		type Mesh,
		type Material,
		type Object3D,
	} from 'three';

	let {
		wireframe = false,
		controller,
		onStats,
	}: {
		wireframe?: boolean;
		controller: InspectorController;
		onStats?: (s: ModelStats) => void;
	} = $props();

	const gltf = useGltf('/models/southwest-737/scene.gltf');
	// invalidate() requests a render. Threlte renders on-demand, so imperative
	// scene mutations (material swaps, visibility toggles) below need an
	// explicit invalidate() to actually paint — otherwise nothing updates
	// until the next OrbitControls drag happens to request a frame.
	const { renderer, camera, invalidate } = useThrelte();

	let normalized = false;

	// ── Selection state ────────────────────────────────────────────────
	const selected = new Set<Mesh>();
	const origMats = new WeakMap<Mesh, Material | Material[]>();
	// One shared highlight material — all selected meshes read the same hot
	// orange. Swapped IN per mesh (original kept in origMats), so unrelated
	// meshes sharing the original material are untouched.
	const highlightMat = new MeshStandardMaterial({
		color: 0xff7a1a,
		emissive: 0xff4400,
		emissiveIntensity: 0.7,
		metalness: 0.1,
		roughness: 0.5,
	});

	function isMesh(o: Object3D): o is Mesh {
		return (o as Mesh).isMesh === true;
	}

	function triCount(m: Mesh): number {
		const g = m.geometry;
		if (!g) return 0;
		const idx = g.getIndex();
		const pos = g.getAttribute('position');
		return Math.round(idx ? idx.count / 3 : pos ? pos.count / 3 : 0);
	}

	function highlight(mesh: Mesh) {
		if (!origMats.has(mesh)) origMats.set(mesh, mesh.material);
		mesh.material = highlightMat;
	}
	function unhighlight(mesh: Mesh) {
		const orig = origMats.get(mesh);
		if (orig) mesh.material = orig;
		origMats.delete(mesh);
	}

	function reportSelection() {
		controller.selection = [...selected].map((m) => ({
			name: m.name || '(unnamed)',
			tris: triCount(m),
		}));
	}

	// ── Load: recenter + normalize + stats + wire up the controller ────
	$effect(() => {
		const g = $gltf;
		if (!g || normalized) return;
		const scene = g.scene;
		// Pass 1 — measure native bounds, scale longest axis to 40 units.
		// (Source units are cm: ~3567 → a 35.6 m fuselage.)
		const box = new Box3().setFromObject(scene);
		const size = box.getSize(new Vector3());
		const maxDim = Math.max(size.x, size.y, size.z) || 1;
		scene.scale.setScalar(40 / maxDim);
		// Pass 2 — recenter via the POST-scale box so the offset is in scaled
		// units (recentering before scaling flung the model off-origin).
		scene.updateMatrixWorld(true);
		const center = new Box3().setFromObject(scene).getCenter(new Vector3());
		scene.position.sub(center);
		normalized = true;

		let meshes = 0;
		let triangles = 0;
		const mats = new Set<Material>();
		scene.traverse((o) => {
			if (!isMesh(o) || !o.geometry) return;
			meshes++;
			triangles += triCount(o);
			const mat = o.material;
			(Array.isArray(mat) ? mat : [mat]).forEach((x) => mats.add(x));
		});
		onStats?.({ meshes, triangles, dims: [size.x, size.y, size.z], materials: mats.size });

		// Imperative controller methods (need the scene root). Each ends with
		// invalidate() so the on-demand renderer paints the change.
		controller.isolate = () => {
			if (selected.size === 0) return;
			scene.traverse((o) => {
				if (isMesh(o)) o.visible = selected.has(o);
			});
			invalidate();
		};
		controller.hide = () => {
			selected.forEach((m) => (m.visible = false));
			invalidate();
		};
		controller.showAll = () => {
			scene.traverse((o) => {
				if (isMesh(o)) o.visible = true;
			});
			invalidate();
		};
		controller.clear = () => {
			selected.forEach(unhighlight);
			selected.clear();
			reportSelection();
			invalidate();
		};
		invalidate();
	});

	// ── Click-to-select (raycast) ──────────────────────────────────────
	const raycaster = new Raycaster();
	const pointer = new Vector2();
	$effect(() => {
		const canvas = renderer?.domElement;
		const root = $gltf?.scene;
		if (!canvas || !root) return;

		const onClick = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
			pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(pointer, camera.current);
			const hit = raycaster
				.intersectObject(root, true)
				.find((h) => isMesh(h.object) && h.object.visible);
			if (!hit) return;
			const mesh = hit.object as Mesh;

			// Plain click replaces the selection; Shift-click toggles add.
			if (!e.shiftKey) {
				selected.forEach(unhighlight);
				selected.clear();
			}
			if (selected.has(mesh)) {
				unhighlight(mesh);
				selected.delete(mesh);
			} else {
				highlight(mesh);
				selected.add(mesh);
			}
			reportSelection();
			invalidate();
		};

		canvas.addEventListener('click', onClick);
		return () => canvas.removeEventListener('click', onClick);
	});

	// ── Wireframe toggle (covers highlight material too) ───────────────
	$effect(() => {
		const g = $gltf;
		if (!g) return;
		const wf = wireframe;
		highlightMat.wireframe = wf;
		g.scene.traverse((o) => {
			if (!isMesh(o)) return;
			const mat = o.material;
			(Array.isArray(mat) ? mat : [mat]).forEach((x) => {
				if (x && 'wireframe' in x) (x as { wireframe: boolean }).wireframe = wf;
			});
		});
		invalidate();
	});
</script>

<T.Color attach="background" args={['#16171c']} />

<T.PerspectiveCamera makeDefault position={[45, 28, 62]} fov={45} near={0.1} far={5000}>
	<OrbitControls enableDamping target={[0, 0, 0]} />
</T.PerspectiveCamera>

<T.AmbientLight intensity={0.85} />
<T.DirectionalLight position={[60, 90, 50]} intensity={1.6} />
<T.DirectionalLight position={[-50, 30, -40]} intensity={0.5} />

<Grid cellSize={2} cellColor="#2a2a33" sectionSize={10} sectionColor="#454552" fadeDistance={400} infiniteGrid />

{#if $gltf}
	<T is={$gltf.scene} />
{/if}
