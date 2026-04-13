/**
 * Fleet management server — Bun HTTP + WebSocket hub.
 *
 * Routes commands from admin → displays over WebSocket (LAN) or SSE (remote).
 * Standalone process: run via `bun run server` from the repo root.
 */

import { serve } from './ws';

const PORT = parseInt(process.env.PORT || '3001', 10);

serve(PORT);
console.log(`[server] Zyeta Aero fleet server running on http://localhost:${PORT}`);
