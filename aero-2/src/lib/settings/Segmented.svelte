<script lang="ts" generics="T">
	/**
	 * Segmented — one-of-N picker, the third control beside Knob and Toggle.
	 *
	 * This exact grid-of-buttons was written out five times in Settings.svelte:
	 * destination, weather, engine, audio mode, fleet role. Every copy carried
	 * its own `class:active` comparison and its own `onclick` assignment, which
	 * is five chances to compare one field and assign another.
	 *
	 * `isActive` is a predicate rather than a value to compare, because the five
	 * pickers do not select uniformly: four set the option itself, while the
	 * destination grid matches on `place.id` and calls `setPlace(loc)`. A
	 * predicate covers both without the component knowing which field it drives.
	 */
	interface Props {
		label: string;
		options: readonly T[];
		isActive: (option: T) => boolean;
		onselect: (option: T) => void;
		/** Defaults to the option, uppercased — which is what four of five want. */
		format?: (option: T) => string;
		/**
		 * Each-key for an option. Defaults to the option ITSELF, not
		 * `String(option)`.
		 *
		 * `String(option)` was the original, and it works for the four callers
		 * that pass string unions — then silently breaks the fifth. `LOCATIONS`
		 * is an array of `Location` objects with no `toString`, so all eleven
		 * keyed to the literal `"[object Object]"`: `each_key_duplicate` thrown
		 * during render, which took the WHOLE settings drawer down to
		 * "Internal Error" the moment an operator pressed `s`.
		 *
		 * Nothing caught it. It is a runtime throw inside an `{#each}`, so
		 * `svelte-check` is green; no unit test mounts the drawer; and the smoke
		 * run loads `/` but never opens the panel, so the kiosk looked perfect.
		 * Exactly the /admin blank-page shape, one keystroke deeper.
		 *
		 * Object identity is the correct default: Svelte compares keys with
		 * `Map` semantics, and these option arrays are module-level constants
		 * whose elements are stable for the life of the page. A caller that
		 * regenerates its options can pass its own key.
		 */
		key?: (option: T) => unknown;
	}

	const { label, options, isActive, onselect, format, key }: Props = $props();
</script>

<section class="section">
	<h4>{label}</h4>
	<div class="grid">
		{#each options as option (key ? key(option) : option)}
			<button
				type="button"
				class="opt"
				class:active={isActive(option)}
				onclick={() => onselect(option)}
			>
				{format ? format(option) : String(option).toUpperCase()}
			</button>
		{/each}
	</div>
</section>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		margin-top: 8px;
	}
	.opt {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		padding: 6px 4px;
		color: #cbd5e1;
		font-size: 0.72rem;
		cursor: pointer;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: all 0.15s ease;
	}
	.opt:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #ffffff;
	}
	.opt.active {
		background: var(--accent-cyan, #38bdf8);
		color: #0b111e;
		font-weight: 600;
		border-color: var(--accent-cyan, #38bdf8);
	}
</style>
