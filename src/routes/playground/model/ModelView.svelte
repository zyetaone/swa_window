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
		/** The mesh currently under the cursor (live hover readout). */
		hovered?: SelEntry | null;
		isolate?: () => void;
		hide?: () => void;
		showAll?: () => void;
		clear?: () => void;
		/** Export exactly the SELECTED meshes to a downloaded .glb — the
		 *  direct path: click the wing + winglet + turbine, then export. */
		exportSelection?: () => void;
		/** Export every currently-VISIBLE mesh — the alternate path: hide the
		 *  parts you don't want, then export what's left. */
		exportVisible?: () => void;
		/** Set after an export so the page can show feedback. */
		lastExport?: { meshes: number; tris: number } | null;
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
		Group,
		MeshStandardMaterial,
		type Mesh,
		type Material,
		type Object3D,
	} from 'three';
	import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

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
	// Hover preview — a cooler cyan so the mesh under the cursor is obvious
	// BEFORE you click. Distinct from the orange selection so the two states
	// never get confused.
	const hoverMat = new MeshStandardMaterial({
		color: 0x3fd9ff,
		emissive: 0x0a8ab0,
		emissiveIntensity: 0.55,
		metalness: 0.1,
		roughness: 0.5,
	});
	let hovered: Mesh | null = null;
	let hoveredOrigMat: Material | Material[] | null = null;

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

	// Restore the currently-hovered mesh to its true material (unless it's
	// selected, in which case the orange must stay). Called before any
	// click/selection mutation so origMats never captures the hover material.
	function clearHover() {
		if (hovered && hoveredOrigMat && !selected.has(hovered)) {
			hovered.material = hoveredOrigMat;
		}
		hovered = null;
		hoveredOrigMat = null;
	}

	function setHover(mesh: Mesh | null) {
		if (mesh === hovered) return;
		clearHover();
		if (mesh && !selected.has(mesh)) {
			hoveredOrigMat = mesh.material;
			mesh.material = hoverMat;
			hovered = mesh;
		} else if (mesh) {
			// Selected meshes keep their orange but still report for the readout.
			hovered = mesh;
		}
		controller.hovered = mesh ? { name: mesh.name || '(unnamed)', tris: triCount(mesh) } : null;
		invalidate();
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
		// Export a set of meshes to a downloaded .glb. Each mesh is cloned
		// with its WORLD transform baked in (so the assembly is preserved
		// even though we strip it out of the original hierarchy), and its
		// real material restored (so the orange highlight isn't exported).
		function exportMeshes(source: Iterable<Mesh>) {
			const group = new Group();
			let meshes = 0;
			let tris = 0;
			for (const o of source) {
				if (!isMesh(o)) continue;
				o.updateWorldMatrix(true, false);
				const clone = o.clone();
				o.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
				const orig = origMats.get(o);
				if (orig) clone.material = orig;
				group.add(clone);
				meshes++;
				tris += triCount(o);
			}
			if (meshes === 0) return;
			new GLTFExporter().parse(
				group,
				(result) => {
					const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = 'wing-extract.glb';
					a.click();
					URL.revokeObjectURL(url);
					controller.lastExport = { meshes, tris };
				},
				(err) => console.error('[model-inspector] export failed', err),
				{ binary: true },
			);
		}

		controller.exportSelection = () => exportMeshes(selected);
		controller.exportVisible = () => {
			const visible: Mesh[] = [];
			scene.traverse((o) => {
				if (isMesh(o) && o.visible) visible.push(o);
			});
			exportMeshes(visible);
		};
		invalidate();
	});

	// ── Click-to-select + hover-preview (raycast) ──────────────────────
	const raycaster = new Raycaster();
	const pointer = new Vector2();

	function pickAt(canvas: HTMLCanvasElement, root: Object3D, clientX: number, clientY: number): Mesh | null {
		const rect = canvas.getBoundingClientRect();
		pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
		raycaster.setFromCamera(pointer, camera.current);
		const hit = raycaster.intersectObject(root, true).find((h) => isMesh(h.object) && h.object.visible);
		return hit ? (hit.object as Mesh) : null;
	}

	$effect(() => {
		const canvas = renderer?.domElement;
		const root = $gltf?.scene;
		if (!canvas || !root) return;

		const onClick = (e: MouseEvent) => {
			// Restore the hovered mesh's true material FIRST so highlight()
			// captures the real original, not the cyan hover material.
			clearHover();
			const mesh = pickAt(canvas, root, e.clientX, e.clientY);
			if (!mesh) return;

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

		// Hover preview — raycast at most once per animation frame (dedups the
		// stream of pointermove events; independent of Threlte's on-demand
		// render loop). setHover() invalidates to paint the cyan preview.
		let rafPending = false;
		let lastX = 0;
		let lastY = 0;
		const onPointerMove = (e: PointerEvent) => {
			lastX = e.clientX;
			lastY = e.clientY;
			if (rafPending) return;
			rafPending = true;
			requestAnimationFrame(() => {
				rafPending = false;
				setHover(pickAt(canvas, root, lastX, lastY));
			});
		};
		const onPointerLeave = () => setHover(null);

		canvas.addEventListener('click', onClick);
		canvas.addEventListener('pointermove', onPointerMove);
		canvas.addEventListener('pointerleave', onPointerLeave);
		return () => {
			canvas.removeEventListener('click', onClick);
			canvas.removeEventListener('pointermove', onPointerMove);
			canvas.removeEventListener('pointerleave', onPointerLeave);
		};
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
