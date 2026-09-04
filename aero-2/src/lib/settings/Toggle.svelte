<script lang="ts">
	/**
	 * Toggle — accessible glassmorphism switch component bound to a boolean setting.
	 */
	interface Props {
		checked: boolean;
		label: string;
		description?: string;
		onchange: (checked: boolean) => void;
	}

	const { checked, label, description, onchange }: Props = $props();
</script>

<label class="toggle-field">
	<div class="toggle-info">
		<span class="toggle-label">{label}</span>
		{#if description}
			<span class="toggle-desc">{description}</span>
		{/if}
	</div>
	<input
		type="checkbox"
		class="toggle-checkbox"
		{checked}
		onchange={(e) => onchange(e.currentTarget.checked)}
	/>
	<span class="toggle-switch" aria-hidden="true"></span>
</label>

<style>
	.toggle-field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0;
		cursor: pointer;
		user-select: none;
	}
	.toggle-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.toggle-label {
		font-size: 0.85rem;
		color: #e2e8f0;
		font-weight: 500;
	}
	.toggle-desc {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.toggle-checkbox {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.toggle-switch {
		position: relative;
		display: inline-block;
		width: 36px;
		height: 20px;
		background: rgba(255, 255, 255, 0.15);
		border-radius: 20px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		flex-shrink: 0;
	}
	.toggle-switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		background: #ffffff;
		border-radius: 50%;
		transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.toggle-checkbox:checked + .toggle-switch {
		background: var(--accent-cyan, #38bdf8);
		border-color: rgba(56, 189, 248, 0.6);
	}
	.toggle-checkbox:checked + .toggle-switch::after {
		transform: translateX(16px);
	}
</style>
