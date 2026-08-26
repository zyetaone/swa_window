/**
 * Server entrypoint for production and Pi fleet deployment.
 * Hands HTTP over to adapter-node's built output (build/index.js).
 */
import { existsSync } from 'node:fs';

process.env.PORT ||= '5173';
const PORT = parseInt(process.env.PORT, 10);

// Production error logging for systemd journalctl
process.on('unhandledRejection', (reason) => {
	console.error('[server] FATAL unhandledRejection:', reason);
	process.exit(1);
});

process.on('uncaughtException', (err) => {
	console.error('[server] FATAL uncaughtException:', err);
	process.exit(1);
});

const BUILD_ENTRY = new URL('./build/index.js', import.meta.url);

if (existsSync(BUILD_ENTRY)) {
	await import('./build/index.js');
	console.log(`[server] Aero Window listening on http://localhost:${PORT}`);
} else {
	console.warn('[server] No build/ found — run `bun run build` first, or use `bun run dev`.');
	Bun.serve({
		port: PORT,
		fetch: () =>
			new Response(
				'Aero Window server: no production build found. Run `bun run build` followed by `bun run start`.',
				{ status: 503, headers: { 'Content-Type': 'text/plain' } }
			)
	});
	console.log(
		`[server] Aero Window listening (degraded 503, no build) on http://localhost:${PORT}`
	);
}
