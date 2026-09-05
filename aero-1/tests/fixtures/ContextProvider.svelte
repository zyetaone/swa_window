<script lang="ts">
	/**
	 * Test fixture: the kiosk case — a provider wrapping the optional child.
	 */
	import { createAeroWindow } from '$lib/model/aero-window.svelte';
	import ContextOptional from './ContextOptional.svelte';

	let { onresolve, onprovide }: {
		onresolve: (model: unknown) => void;
		onprovide: (model: unknown) => void;
	} = $props();

	// svelte-ignore state_referenced_locally -- calling at INIT is the point:
	// that is the exact moment the context lookup used to throw.
	onprovide(createAeroWindow());
</script>

<ContextOptional {onresolve} />
