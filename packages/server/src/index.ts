/**
 * @zyeta/server — Fleet management server
 *
 * Bun HTTP + WebSocket server for admin↔display communication.
 * - WebSocket hub: routes commands from admin to displays
 * - REST API: device list, scene push, health check
 * - Device registry: in-memory with heartbeat timeout
 */

import { serve } from './ws';

const PORT = parseInt(process.env.PORT || '3001', 10);

serve(PORT);
console.log(`[server] Zyeta Aero server running on http://localhost:${PORT}`);
