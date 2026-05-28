<script lang="ts">
	/**
	 * Stars — Instanced Points scattered on a large sphere. Faded by
	 * (1 - nightFactor) so they're invisible at day, pop in at dusk, full
	 * at deep night.
	 */
	import { T } from '@threlte/core';
	import * as THREE from 'three';
	import { STARS_RADIUS_M } from './state.svelte';

	let { nightFactor }: { nightFactor: number } = $props();

	// 2000 stars uniformly sampled on a sphere far enough out that camera
	// motion at Earth-cruise altitudes is parallax-free.
	const STAR_COUNT = 2000;
	const positions = new Float32Array(STAR_COUNT * 3);
	for (let i = 0; i < STAR_COUNT; i++) {
		const u = Math.random();
		const v = Math.random();
		const theta = 2 * Math.PI * u;
		const phi = Math.acos(2 * v - 1);
		const r = STARS_RADIUS_M;
		positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
		positions[i * 3 + 1] = r * Math.cos(phi);
		positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

	let opacity = $derived(nightFactor);

	// Release the BufferGeometry's GPU buffers when this component
	// unmounts. Without this, each /playground/three revisit leaks one
	// position buffer (~24 KB) plus its WebGL handle.
	$effect(() => () => geometry.dispose());
</script>

<T.Points {geometry}>
	<T.PointsMaterial
		size={2}
		color={0xffffff}
		transparent
		{opacity}
		sizeAttenuation={false}
		depthWrite={false}
	/>
</T.Points>
