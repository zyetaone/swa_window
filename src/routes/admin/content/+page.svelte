<script lang="ts">
	/**
	 * /content — drag-drop content management UI.
	 *
	 * Lists installed bundles and uploaded assets. Drop a `.json` file on the
	 * page → POST /api/content. Drop an `.mp4` / `.png` → POST /api/assets.
	 *
	 * Mutating routes require `Authorization: Bearer $AERO_ADMIN_TOKEN`.
	 * sessionStorage caches the token after first prompt; on 401 we clear
	 * and re-prompt.
	 */
	import { onMount } from 'svelte';
	import type { ContentBundle } from '$lib/scene/bundle/types';
	import type { AssetInfo } from '$lib/server/scene/bundle/assets';
	import { ensureAdminToken, clearAdminToken, adminAuthHeader } from '$lib/http/admin-token';

	// $state.raw — both arrays are only ever reassigned wholesale from fetch
	// responses; never mutated in place. Avoids the proxy traversal cost.
	let bundles = $state.raw<ContentBundle[]>([]);
	let assets = $state.raw<AssetInfo[]>([]);
	let toast = $state<{ kind: 'ok' | 'err'; msg: string } | null>(null);
	let dragging = $state(false);
	let busy = $state(false);

	function flash(kind: 'ok' | 'err', msg: string) {
		toast = { kind, msg };
		setTimeout(() => { toast = null; }, 3500);
	}

	async function refresh() {
		try {
			const [bRes, aRes] = await Promise.all([
				fetch('/api/content'),
				fetch('/api/assets'),
			]);
			if (bRes.ok) bundles = (await bRes.json()).bundles ?? [];
			if (aRes.ok) assets = (await aRes.json()).assets ?? [];
		} catch (e) {
			flash('err', `refresh failed: ${(e as Error).message}`);
		}
	}

	/** 401 → clear cached token, tell the operator. Caller decides whether to retry. */
	function handle401(label: string): void {
		clearAdminToken();
		flash('err', `${label}: 401 — token rejected. Re-enter on next attempt.`);
	}

	async function uploadBundle(text: string) {
		const token = ensureAdminToken();
		if (!token) { flash('err', 'bundle: token required'); return; }
		busy = true;
		try {
			const parsed = JSON.parse(text);
			const res = await fetch('/api/content', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...adminAuthHeader(token) },
				body: JSON.stringify(parsed),
			});
			if (res.status === 401) { handle401('bundle'); return; }
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: res.statusText }));
				flash('err', `bundle: ${err.message ?? res.status}`);
				return;
			}
			const { id } = await res.json();
			flash('ok', `installed bundle: ${id}`);
			await refresh();
		} catch (e) {
			flash('err', `parse failed: ${(e as Error).message}`);
		} finally {
			busy = false;
		}
	}

	async function uploadAsset(file: File) {
		const token = ensureAdminToken();
		if (!token) { flash('err', 'asset: token required'); return; }
		busy = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch('/api/assets', {
				method: 'POST',
				headers: adminAuthHeader(token),
				body: fd,
			});
			if (res.status === 401) { handle401('asset'); return; }
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: res.statusText }));
				flash('err', `asset: ${err.message ?? res.status}`);
				return;
			}
			const { asset } = await res.json();
			await navigator.clipboard?.writeText(asset.url).catch(() => {});
			flash('ok', `asset stored: ${asset.url} (URL copied to clipboard)`);
			await refresh();
		} catch (e) {
			flash('err', `upload failed: ${(e as Error).message}`);
		} finally {
			busy = false;
		}
	}

	async function deleteBundle(id: string) {
		if (!confirm(`Remove bundle "${id}"?`)) return;
		const token = ensureAdminToken();
		if (!token) { flash('err', 'delete: token required'); return; }
		const res = await fetch(`/api/content/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: adminAuthHeader(token),
		});
		if (res.status === 401) { handle401('delete'); return; }
		if (res.ok) {
			flash('ok', `removed: ${id}`);
			await refresh();
		} else {
			flash('err', `delete failed: ${res.status}`);
		}
	}

	async function handleFiles(files: FileList | File[]) {
		for (const file of Array.from(files)) {
			if (file.name.endsWith('.json')) {
				const text = await file.text();
				await uploadBundle(text);
			} else {
				await uploadAsset(file);
			}
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files) void handleFiles(e.dataTransfer.files);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function onDragLeave() {
		dragging = false;
	}

	let fileInput: HTMLInputElement;

	onMount(refresh);
</script>

<svelte:head>
	<title>Aero — Content</title>
</svelte:head>

<main
	class={['page', dragging && 'dragging']}
	ondrop={onDrop}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	role="region"
	aria-label="Content management"
>
	<header>
		<h1>Aero — Content</h1>
		<p class="subtitle">Drag bundle .json or asset (mp4/webm/png/jpg/webp) anywhere on this page.</p>
	</header>

	<section class="dropzone">
		<button class="upload-btn" onclick={() => fileInput.click()} disabled={busy}>
			Choose files
		</button>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			accept=".json,.mp4,.webm,.png,.jpg,.jpeg,.webp"
			style="display:none"
			onchange={(e) => {
				const files = (e.currentTarget as HTMLInputElement).files;
				if (files) void handleFiles(files);
			}}
		/>
		<span class="hint">…or drop them here</span>
	</section>

	<section>
		<h2>Bundles ({bundles.length})</h2>
		{#if bundles.length === 0}
			<p class="empty">No bundles installed. Drop a .json to add one.</p>
		{:else}
			<table>
				<thead>
					<tr><th>id</th><th>type</th><th>kind</th><th>z</th><th></th></tr>
				</thead>
				<tbody>
					{#each bundles as b (b.id)}
						<tr>
							<td><code>{b.id}</code></td>
							<td>{b.type}</td>
							<td>{b.kind}</td>
							<td>{b.z}</td>
							<td><button class="danger" onclick={() => deleteBundle(b.id)}>delete</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<section>
		<h2>Assets ({assets.length})</h2>
		{#if assets.length === 0}
			<p class="empty">No assets uploaded. Drop a media file to get a stable URL you can put in a bundle.</p>
		{:else}
			<table>
				<thead>
					<tr><th>filename</th><th>size</th><th>url</th></tr>
				</thead>
				<tbody>
					{#each assets as a (a.filename)}
						<tr>
							<td><code>{a.filename}</code></td>
							<td>{(a.size / 1024).toFixed(1)} KB</td>
							<td><code>{a.url}</code></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	{#if toast}
		<div class="toast {toast.kind}">{toast.msg}</div>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, sans-serif;
		background: #0f1117;
		color: #e0e0e6;
	}
	.page {
		min-height: 100vh;
		padding: 32px 48px;
		max-width: 1100px;
		margin: 0 auto;
		transition: background 0.15s;
	}
	.page.dragging {
		background: rgba(80, 110, 200, 0.06);
		outline: 2px dashed rgba(120, 150, 230, 0.5);
		outline-offset: -16px;
	}
	header h1 {
		margin: 0 0 4px;
		font-size: 20px;
		font-weight: 700;
	}
	.subtitle {
		margin: 0 0 24px;
		color: #888;
		font-size: 14px;
	}
	h2 {
		margin: 24px 0 12px;
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #888;
		font-weight: 500;
	}
	.dropzone {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: #16181d;
		border: 1px dashed #3f3f46;
		padding: 8px 16px;
		background: #2563eb;
		border: none;
		border-radius: 6px;
		color: #fff;
		font-size: 13px;
		cursor: pointer;
	}
	.upload-btn:hover:not(:disabled) { background: #1d4ed8; }
	.upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.hint { color: #888; font-size: 13px; }
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		background: #16181d;
		border: 1px solid #27272a;
		border-radius: 6px;
		overflow: hidden;
	}
	th {
		text-align: left;
		padding: 10px 12px;
		background: #1a1c23;
		color: #71717a;
		font-weight: 500;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid #27272a;
	}
	td {
		padding: 10px 12px;
		border-bottom: 1px solid #1e1e24;
		color: #d4d4d8;
	}
	tr:last-child td { border-bottom: none; }
	code {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #aac;
	}
	.danger {
		padding: 4px 10px;
		background: transparent;
		border: 1px solid #7f1d1d;
		border-radius: 4px;
		color: #fca5a5;
		font-size: 11px;
		cursor: pointer;
	}
	.danger:hover { background: rgba(204, 60, 60, 0.1); border-color: #884040; }
	.empty {
		color: #888;
		font-size: 13px;
		font-style: italic;
		padding: 12px;
	}
	.toast {
		position: fixed;
		bottom: 24px;
		right: 24px;
		padding: 10px 16px;
		border-radius: 6px;
		font-size: 13px;
		max-width: 480px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		animation: slide-in 0.2s ease-out;
	}
	.toast.ok { background: #14532d; color: #86efac; border: 1px solid #3a6a40; }
	.toast.err { background: #7f1d1d; color: #fca5a5; border: 1px solid #6a3a40; }
	@keyframes slide-in {
		from { transform: translateY(20px); opacity: 0; }
		to   { transform: translateY(0);    opacity: 1; }
	}
</style>
