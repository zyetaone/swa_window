<script lang="ts">
	/**
	 * DevWingTuner — DEV-ONLY floating slider panel for posing the wing GLB
	 * live in the Three.js lab.
	 *
	 * Reads/writes the `window.__wing` hook that Wing.svelte exposes in dev
	 * (placement + model). Unlike a console-injected panel it's part of the
	 * page, so it survives HMR + reloads. Drag the sliders, watch the wing
	 * move, then copy the readout line and bake it into Wing.svelte's
	 * WING_* constants.
	 *
	 * DELETE the <DevWingTuner/> mount + this file once the pose is finalized.
	 */
	interface Vec3Like {
		x: number;
		y: number;
		z: number;
		set: (x: number, y: number, z: number) => void;
	}
	interface WingHook {
		model: {
			rotation: Vec3Like;
			scale: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
		};
		placement: { position: Vec3Like };
		// posX goes through setXBase — the wing tick owns placement.position.x
		// (re-derives it from the X base − fuselageOffset every frame).
		setXBase?: (v: number) => void;
		xBase?: number;
	}
	const getHook = (): WingHook | undefined =>
		(window as unknown as { __wing?: WingHook }).__wing;

	let rx = $state(-0.9);
	let ry = $state(0);
	let rz = $state(0.2);
	let px = $state(2.5);
	let py = $state(-3.2);
	let pz = $state(-9);
	let scX = $state(1.11);
	let scY = $state(1.11);
	let scZ = $state(1.11);
	let ready = $state(false);
	let copied = $state(false);

	// Seed slider values from the live wing once the GLB has loaded.
	$effect(() => {
		const seed = (): boolean => {
			const w = getHook();
			if (!w) return false;
			rx = +w.model.rotation.x.toFixed(3);
			ry = +w.model.rotation.y.toFixed(3);
			rz = +w.model.rotation.z.toFixed(3);
			px = +(w.xBase ?? w.placement.position.x).toFixed(2);
			py = +w.placement.position.y.toFixed(2);
			pz = +w.placement.position.z.toFixed(2);
			scX = +w.model.scale.x.toFixed(3);
			scY = +w.model.scale.y.toFixed(3);
			scZ = +w.model.scale.z.toFixed(3);
			ready = true;
			return true;
		};
		if (seed()) return;
		const id = setInterval(() => {
			if (seed()) clearInterval(id);
		}, 200);
		return () => clearInterval(id);
	});

	// Push slider changes onto the live wing every time one moves.
	$effect(() => {
		if (!ready) return;
		const w = getHook();
		if (!w) return;
		w.model.rotation.set(rx, ry, rz);
		// posX → X base (tick owns placement.x); posY/posZ direct (tick leaves them).
		if (w.setXBase) w.setXBase(px);
		else w.placement.position.x = px;
		w.placement.position.y = py;
		w.placement.position.z = pz;
		w.model.scale.set(scX, scY, scZ);
	});

	const dump = $derived(
		`rot(${rx.toFixed(3)}, ${ry.toFixed(3)}, ${rz.toFixed(3)}) pos(${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}) scale(${scX.toFixed(3)}, ${scY.toFixed(3)}, ${scZ.toFixed(3)})`,
	);

	async function copy() {
		try {
			await navigator.clipboard.writeText(dump);
			copied = true;
			setTimeout(() => (copied = false), 1400);
		} catch {
			console.log('[wing-tuner]', dump);
		}
	}
</script>

<fieldset class="wing-tuner">
	<legend>Wing pose{ready ? '' : ' · waiting…'}</legend>

	<label>rotX <span>{rx.toFixed(2)}</span>
		<input type="range" min="-3.2" max="3.2" step="0.02" bind:value={rx} /></label>
	<label>rotY <span>{ry.toFixed(2)}</span>
		<input type="range" min="-3.2" max="3.2" step="0.02" bind:value={ry} /></label>
	<label>rotZ <span>{rz.toFixed(2)}</span>
		<input type="range" min="-3.2" max="3.2" step="0.02" bind:value={rz} /></label>
	<label>posX <span>{px.toFixed(1)}</span>
		<input type="range" min="-16" max="16" step="0.1" bind:value={px} /></label>
	<label>posY <span>{py.toFixed(1)}</span>
		<input type="range" min="-10" max="2" step="0.1" bind:value={py} /></label>
	<label>posZ <span>{pz.toFixed(1)}</span>
		<input type="range" min="-26" max="-3" step="0.1" bind:value={pz} /></label>
	<label>scaleX <span>{scX.toFixed(2)}</span>
		<input type="range" min="0.05" max="3" step="0.01" bind:value={scX} /></label>
	<label>scaleY <span>{scY.toFixed(2)}</span>
		<input type="range" min="0.05" max="3" step="0.01" bind:value={scY} /></label>
	<label>scaleZ <span>{scZ.toFixed(2)}</span>
		<input type="range" min="0.05" max="3" step="0.01" bind:value={scZ} /></label>

	<button class="dump" onclick={copy}>{copied ? 'copied ✓' : dump}</button>
</fieldset>

<style>
	/* Rendered inside the LabShell drawer as a fieldset — match that chrome.
	   LabShell's scoped fieldset/label CSS can't reach slotted content, so the
	   styling is restated here. */
	.wing-tuner {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 12px;
		margin: 0 0 16px;
		padding: 12px;
		font: 12px/1.4 ui-monospace, monospace;
	}
	.wing-tuner legend {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #666;
		padding: 0 8px;
	}
	label {
		display: block;
		margin: 4px 0;
		color: #ccc;
	}
	label span {
		color: #7faeff;
		float: right;
	}
	input[type='range'] {
		width: 100%;
		accent-color: #7faeff;
		margin: 2px 0 4px;
	}
	.dump {
		margin-top: 8px;
		width: 100%;
		padding: 6px;
		background: rgba(0, 0, 0, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 6px;
		color: #9cffb0;
		font: 10px/1.4 ui-monospace, monospace;
		text-align: left;
		word-break: break-all;
		cursor: pointer;
	}
	.dump:hover {
		border-color: rgba(156, 255, 176, 0.4);
	}
</style>
